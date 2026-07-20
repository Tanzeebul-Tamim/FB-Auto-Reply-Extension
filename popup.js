// popup.js — FB AutoReply AI
// Handles settings load/save and all popup UI interactions

const el = {
  toggle:       document.getElementById('enabled-toggle'),
  badge:        document.getElementById('status-badge'),
  apiKey:       document.getElementById('api-key'),
  peekBtn:      document.getElementById('peek-btn'),
  systemPrompt: document.getElementById('system-prompt'),
  delay:        document.getElementById('delay'),
  delayDisplay: document.getElementById('delay-display'),
  saveBtn:      document.getElementById('save-btn'),
  statusMsg:    document.getElementById('status-msg')
};

export const DEFAULT_PROMPT = `You are replying to Facebook messages on behalf of the user.
Keep responses natural, short, and conversational — 1 to 3 sentences unless the topic needs more.
Match the tone of the message: casual if they're casual, more thoughtful if they're serious.
Respond in the same language they write in.
Never reveal you are an AI or a bot.
If you're unsure what to say, ask a simple follow-up question.`;

// ---- Load saved settings ----
chrome.storage.sync.get(['apiKey', 'systemPrompt', 'enabled', 'delay'], (data) => {
  if (data.apiKey) el.apiKey.value = data.apiKey;
  el.systemPrompt.value = data.systemPrompt || DEFAULT_PROMPT;
  el.delay.value = data.delay || 3;
  el.delayDisplay.textContent = `${el.delay.value}s`;

  const enabled = data.enabled || false;
  el.toggle.checked = enabled;
  setBadge(enabled);
});

// ---- Toggle on/off ----
el.toggle.addEventListener('change', () => {
  const enabled = el.toggle.checked;
  setBadge(enabled);
  chrome.storage.sync.set({ enabled });
});

function setBadge(enabled) {
  el.badge.textContent = enabled ? 'ON' : 'OFF';
  el.badge.className = enabled ? 'status-badge on' : 'status-badge';
}

// ---- Show/hide API key ----
el.peekBtn.addEventListener('click', () => {
  const hidden = el.apiKey.type === 'password';
  el.apiKey.type = hidden ? 'text' : 'password';
  el.peekBtn.textContent = hidden ? '🙈' : '👁';
});

// ---- Delay slider live update ----
el.delay.addEventListener('input', () => {
  el.delayDisplay.textContent = `${el.delay.value}s`;
});

// ---- Save settings ----
el.saveBtn.addEventListener('click', () => {
  const apiKey = el.apiKey.value.trim();
  const systemPrompt = el.systemPrompt.value.trim();
  const delay = parseInt(el.delay.value) || 3;

  if (!apiKey) {
    showStatus('API key is required.', true);
    return;
  }
  if (!apiKey.startsWith('gsk_')) {
    showStatus('Key should start with "gsk_" — check it again.', true);
    return;
  }
  if (!systemPrompt) {
    showStatus('System prompt cannot be empty.', true);
    return;
  }

  chrome.storage.sync.set({ apiKey, systemPrompt, delay }, () => {
    showStatus('Settings saved!');
  });
});

function showStatus(msg, isError = false) {
  el.statusMsg.textContent = msg;
  el.statusMsg.className = isError ? 'status-msg error' : 'status-msg';
  setTimeout(() => { el.statusMsg.textContent = ''; }, 3500);
}
