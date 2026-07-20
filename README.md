# FB AutoReply AI — Setup Guide

Auto-replies to your Facebook Messenger conversations using Groq's free LLaMA AI.

---

## Prerequisites
- Google Chrome or Brave browser
- A free Groq account (takes 2 minutes to create)
- Facebook account with Messenger

---

## Step 1 — Get a Free Groq API Key

1. Go to **https://console.groq.com**
2. Sign up with Google, GitHub, or email (it's free)
3. Go to **API Keys** in the left sidebar
4. Click **Create API Key** — name it anything (e.g., "fb-bot")
5. Copy the key (starts with `gsk_...`) — you'll only see it once

**Free tier limits:** 14,400 requests/day, 30/minute — plenty for personal use.

---

## Step 2 — Load the Extension

### Chrome
1. Open Chrome and go to: `chrome://extensions`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select the `fb-autoreply-extension` folder you downloaded
5. The extension icon (🤖) will appear in your toolbar

### Brave
1. Go to: `brave://extensions`
2. Toggle **Developer mode** ON
3. Click **Load unpacked**
4. Select the `fb-autoreply-extension` folder
5. Extension icon appears in toolbar

---

## Step 3 — Configure the Bot

1. Click the 🤖 icon in your browser toolbar
2. Paste your **Groq API key** into the field
3. Edit the **System Prompt** to personalize how the AI sounds like you:
   - Example: *"You are replying to Facebook messages on behalf of Tamim. You're friendly and a bit witty. Keep replies short unless the topic is serious."*
4. Set a **Response Delay** (3–8 seconds recommended — looks more natural)
5. Click **Save Settings**

---

## Step 4 — Use the Bot

1. Go to **https://www.facebook.com/messages**
2. Open a **specific conversation** (click on a chat thread)
3. Click the 🤖 toolbar icon
4. Flip the **toggle to ON**
5. Leave that conversation open — when a message arrives, the bot will:
   - Wait your configured delay
   - Generate a reply using the last 16 messages as context
   - Type and send it automatically

**To stop:** flip the toggle to OFF, or close the tab.

---

## Debugging

Open Chrome DevTools on the Facebook tab (F12) and check the **Console** tab.
The bot logs everything with the `[FB AutoReply]` prefix:

```
[FB AutoReply] Settings loaded. Bot enabled: true
[FB AutoReply] Observer active. Watching for incoming messages...
[FB AutoReply] New incoming message: hey what's up
[FB AutoReply] Waiting 4.2s before responding...
[FB AutoReply] Calling Groq with 8 messages of context...
[FB AutoReply] Got reply: Not much, just chilling. You?
[FB AutoReply] Reply sent successfully!
```

---

## Known Limitations

- **Facebook's DOM changes** — if Facebook updates their layout, selectors may break.
  Fix: open an issue or re-check the `content.js` selector fallbacks.
- **Single conversation only** — the bot works on whichever conversation tab you have open.
- **SPA navigation** — switching conversations is handled automatically, but give it 2–3 seconds to re-initialize.
- **Facebook ToS** — using bots on personal accounts violates Facebook's Terms of Service.
  This is for personal/educational use. Use responsibly.

---

## Changing the AI Model

Open `background.js` and change the `model` field on line ~17:
```js
model: 'llama-3.1-8b-instant',  // Fast, free
// model: 'llama-3.3-70b-versatile',  // Better quality, slightly slower
// model: 'gemma2-9b-it',             // Alternative fast model
```

Check https://console.groq.com/docs/models for the full list.
