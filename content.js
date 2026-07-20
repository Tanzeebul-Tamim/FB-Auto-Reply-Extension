// content.js — FB AutoReply AI
// Injected into https://www.facebook.com/messages/*
// This script watches for new incoming messages, generates a reply via Groq,
// types it into the input, and sends it.

// =====================================================================
// STATE
// =====================================================================

let settings = {
    apiKey: "",
    systemPrompt: `You are replying to Facebook messages on behalf of the user.
Keep responses natural, short, and conversational — 1 to 3 sentences unless the topic needs more.
Match the tone of the message: casual if they're casual, more thoughtful if they're serious.
Respond in the same language they write in.
Never reveal you are an AI or a bot.
If you're unsure what to say, ask a simple follow-up question.`,
    enabled: false,
    delay: 3,
};

// processedElements: WeakSet of DOM nodes already handled (cleared on re-render)
const processedElements = new WeakSet();

// recentlyProcessed: text -> timestamp — catches duplicates across React re-renders
const recentlyProcessed = new Map();

let isResponding = false; // Lock: prevents processing a second message while one is in flight
let lastSentTime = 0; // Timestamp of last bot-sent message (to avoid processing own messages)
let messageObserver = null;
let lastUrl = window.location.href;

// =====================================================================
// SETTINGS
// =====================================================================

function loadSettings(callback) {
    chrome.storage.sync.get(
        ["apiKey", "systemPrompt", "enabled", "delay"],
        (data) => {
            settings = { ...settings, ...data };
            log("Settings loaded. Bot enabled:", settings.enabled);
            if (callback) callback();
        },
    );
}

chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
        settings[key] = change.newValue;
        log(`Setting updated — ${key}:`, change.newValue);
    }
});

// =====================================================================
// DOM SELECTORS — multiple fallbacks since Facebook's DOM changes often
// =====================================================================

function getMessageInput() {
    const selectors = [
        'div[contenteditable="true"][role="textbox"]',
        'div[data-lexical-editor="true"]',
        '[aria-label="Message"][contenteditable]',
        '[contenteditable="true"]',
    ];
    for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el;
    }
    return null;
}

function getSendButton() {
    const selectors = [
        '[aria-label="Send"][role="button"]',
        'div[aria-label="Send"]',
        '[data-testid="mwc-composer-send-button"]',
    ];
    for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el;
    }
    return null;
}

function getMessagesArea() {
    const selectors = [
        '[data-pagelet="MWMessageListContainer"]',
        '[data-scope="messages_table"]',
        '[role="main"]',
    ];
    for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el;
    }
    return null;
}

// =====================================================================
// MESSAGE DETECTION
// =====================================================================

// Determine if a message element is incoming (from them) or outgoing (from me).
// Facebook always left-aligns incoming messages via flex-start and right-aligns
// outgoing via flex-end. We walk up the DOM tree to find this.
function isIncomingMessage(element) {
    let el = element;
    for (let i = 0; i < 15; i++) {
        if (!el || !el.parentElement) break;
        el = el.parentElement;
        if (el.getAttribute("role") === "main") break;

        const justify = window.getComputedStyle(el).justifyContent;
        if (justify === "flex-end") return false; // My message (right side)
        if (justify === "flex-start") return true; // Their message (left side)
    }
    // Fallback: pixel position check
    const rect = element.getBoundingClientRect();
    return rect.left < window.innerWidth * 0.45;
}

// Filter out obvious UI text that isn't a real message
function isLikelyMessage(text) {
    if (!text || text.length < 1 || text.length > 3000) return false;
    const uiPatterns = [
        /^You sent/i,
        /^Active now/i,
        /^Active \d/i,
        /^Send message/i,
        /^GIF$/,
        /^Sticker$/,
        /^Message$/,
        /^\d+[mh]$/,
        /^Yesterday$/,
        /^Today$/,
        /^Just now$/,
        /^Seen$/,
        /^Delivered$/,
        /^Sending\.\.\.$/,
    ];
    for (const p of uiPatterns) {
        if (p.test(text)) return false;
    }
    return true;
}

function isAlreadyProcessed(element, text) {
    if (processedElements.has(element)) return true;
    const lastTime = recentlyProcessed.get(text);
    if (lastTime && Date.now() - lastTime < 30000) return true; // 30s dedup window
    return false;
}

function markAsProcessed(element, text) {
    processedElements.add(element);
    recentlyProcessed.set(text, Date.now());
    // Keep the map clean
    if (recentlyProcessed.size > 300) {
        const cutoff = Date.now() - 120000;
        for (const [k, t] of recentlyProcessed) {
            if (t < cutoff) recentlyProcessed.delete(k);
        }
    }
}

// Scan all message text divs and return any NEW incoming ones
function findNewIncomingMessages() {
    const area = document;
    if (!area) {
        return [];
    }
    const result = [];
    // const candidates = area.querySelectorAll('div[dir="auto"]');
    const candidates = document.querySelectorAll('div[dir="auto"]');

    for (const div of candidates) {
        const text = div.textContent.trim();
        const incoming = isIncomingMessage(div);

        if (!isLikelyMessage(text)) {
            processedElements.add(div); // Mark as seen so we skip it next time
            continue;
        }
        if (isAlreadyProcessed(div, text)) {
            if (!processedElements.has(div)) processedElements.add(div);
            continue;
        }
        markAsProcessed(div, text);
        if (incoming) {
            result.push({ text, element: div });
        }
    }
    return result;
}

// Pre-load all currently visible messages as "already seen"
// so we don't reply to old messages when the bot first turns on
function markExistingMessagesAsSeen() {
    const area = getMessagesArea();
    if (!area) return;
    let count = 0;
    for (const div of area.querySelectorAll('div[dir="auto"]')) {
        processedElements.add(div);
        const text = div.textContent.trim();
        if (text) {
            recentlyProcessed.set(text, Date.now());
            count++;
        }
    }
    log(`Pre-loaded ${count} existing messages as seen.`);
}

// =====================================================================
// CONVERSATION HISTORY (for context-aware replies)
// =====================================================================

function extractConversationHistory() {
    const history = [];
    const divs = Array.from(document.querySelectorAll('div[dir="auto"]'));

    for (const div of divs.slice(-16)) {
        // Last 16 messages max
        const text = div.textContent.trim();
        const role = isIncomingMessage(div) ? "user" : "assistant";
        const last = history[history.length - 1];
        if (last && last.role === role && last.content === text) continue; // skip exact dups
        history.push({ role, content: text });
    }
    return history;
}

// =====================================================================
// TEXT INPUT — inject text into Facebook's Lexical (React) editor
// =====================================================================

async function typeIntoInput(text) {
    const input = getMessageInput();
    if (!input) {
        log("ERROR: Message input not found");
        return false;
    }

    input.focus();
    await sleep(200);

    // Clear existing content
    document.execCommand("selectAll", false, null);
    await sleep(50);
    document.execCommand("delete", false, null);
    await sleep(50);

    // ==========================
    // Method 1: execCommand
    // ==========================
    const ok = document.execCommand("insertText", false, text);

    // Messenger updates the editor asynchronously
    await sleep(300);

    if (input.textContent.trim().length > 0) {
        return true;
    }

    // ==========================
    // Method 2: Selection API
    // ==========================

    input.textContent = "";
    input.focus();

    const selection = window.getSelection();
    selection.removeAllRanges();

    const range = document.createRange();
    range.selectNodeContents(input);
    range.deleteContents();

    const textNode = document.createTextNode(text);
    range.insertNode(textNode);

    range.setStartAfter(textNode);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    input.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
        }),
    );

    await sleep(200);

    if (input.textContent.trim().length > 0) {
        return true;
    }

    // ==========================
    // Last resort
    // ==========================

    input.textContent = text;

    ["input", "change", "keyup"].forEach((evt) =>
        input.dispatchEvent(new Event(evt, { bubbles: true })),
    );

    await sleep(200);

    return input.textContent.trim().length > 0;
}

async function sendMessage() {
    await sleep(300);

    const btn = getSendButton();
    if (btn) {
        btn.click();
        log("Sent via Send button.");
        return true;
    }

    // Fallback: Enter key press
    const input = getMessageInput();
    if (input) {
        const opts = {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
        };
        input.dispatchEvent(new KeyboardEvent("keydown", opts));
        await sleep(50);
        input.dispatchEvent(new KeyboardEvent("keyup", opts));
        log("Sent via Enter key.");
        return true;
    }

    log("ERROR: Could not find Send button or input to send message.");
    return false;
}

// =====================================================================
// GROQ API CALL (via background service worker)
// =====================================================================

async function callGroq(messages) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: "CALL_GROQ",
                payload: {
                    apiKey: settings.apiKey,
                    systemPrompt: settings.systemPrompt,
                    messages,
                },
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response) {
                    reject(new Error("No response from background worker"));
                    return;
                }
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(new Error(response.error));
                }
            },
        );
    });
}

// =====================================================================
// CORE BOT LOGIC
// =====================================================================

async function handleNewMessage(messageText) {
    if (!settings.enabled || !settings.apiKey) return;
    if (isResponding) {
        log("Already responding, skipping this message.");
        return;
    }
    // Don't process messages within 5 seconds of sending one (avoids echo)
    if (Date.now() - lastSentTime < 5000) {
        log("Cooldown: too soon after last sent message.");
        return;
    }

    isResponding = true;
    log("New incoming message:", messageText);

    try {
        // Add a human-like delay before responding
        const delayMs = (settings.delay || 3) * 1000 + Math.random() * 1500;
        log(`Waiting ${(delayMs / 1000).toFixed(1)}s before responding...`);
        await sleep(delayMs);

        const history = extractConversationHistory();
        log("Calling Groq with", history.length, "messages of context...");

        const reply = await callGroq(history);
        if (!reply) {
            log("Empty reply from Groq.");
            return;
        }
        log("Got reply:", reply);
        const typed = await typeIntoInput(reply);
        if (!typed) {
            log("ERROR: Could not type reply into input.");
            return;
        }

        const sent = await sendMessage();
        if (sent) {
            lastSentTime = Date.now();
            log("Reply sent successfully!");
        }
    } catch (err) {
        log("ERROR during handleNewMessage:", err.message);
    } finally {
        isResponding = false;
    }
}

// =====================================================================
// MUTATION OBSERVER — watches for new messages
// =====================================================================

function startObserver() {
    if (messageObserver) messageObserver.disconnect();

    markExistingMessagesAsSeen();

    // const target = getMessagesArea() || document.body;
    const target = document.body;

    messageObserver = new MutationObserver((mutations) => {
        if (!settings.enabled || isResponding) return;
        const hadAdditions = mutations.some((m) => m.addedNodes.length > 0);
        if (!hadAdditions) return;

        clearTimeout(window.__fbARDebounce);
        window.__fbARDebounce = setTimeout(() => {
            const newMessages = findNewIncomingMessages();
            if (newMessages.length === 0) return;
            if (newMessages.length > 0) {
                const last = newMessages[newMessages.length - 1];
                log(`Detected ${newMessages.length} new incoming message(s).`);
                handleNewMessage(last.text);
            }
        }, 600); // Wait 600ms for DOM to settle after mutation
    });

    messageObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
    });
    log("Observer active. Watching for incoming messages...");
}

// =====================================================================
// SPA NAVIGATION — Facebook is a single-page app
// =====================================================================

const navObserver = new MutationObserver(() => {
    const current = window.location.href;
    if (current !== lastUrl) {
        lastUrl = current;
        log("Navigation detected. Re-initializing in 2s...");
        if (messageObserver) messageObserver.disconnect();
        setTimeout(init, 2000);
    }
});
navObserver.observe(document.body, { childList: true, subtree: true });

// =====================================================================
// INIT
// =====================================================================

function init() {
    if (!window.location.href.includes("/messages")) return;
    log("Initializing...");

    let attempts = 0;
    const poller = setInterval(() => {
        attempts++;
        const area = getMessagesArea();
        const input = getMessageInput();
        if (area && input) {
            clearInterval(poller);
            startObserver();
            log("Ready!");
        } else if (attempts > 25) {
            clearInterval(poller);
            log(
                "Timed out waiting for the messages page to fully load. Try refreshing.",
            );
        }
    }, 1000);
}

// =====================================================================
// UTILITIES
// =====================================================================

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function log(...args) {
    console.log("[FB AutoReply]", ...args);
}

// =====================================================================
// START
// =====================================================================

loadSettings(() => {
    setTimeout(init, 2500); // Give Facebook a moment to render
});
