// background.js — Service Worker
// Handles all Groq API calls. Content scripts can't call external APIs
// due to CORS, so they send messages here and we make the fetch.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CALL_GROQ') {
    callGroqAPI(request.payload)
      .then(reply => sendResponse({ success: true, data: reply }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // REQUIRED: keeps the message channel open for async response
  }
});

async function callGroqAPI({ apiKey, systemPrompt, messages }) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant', // Fast, free, great for chat
      max_tokens: 512,
      temperature: 0.75,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ]
    })
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      errorMsg = errData.error?.message || errorMsg;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error('No content in API response');
  return reply.trim();
}
