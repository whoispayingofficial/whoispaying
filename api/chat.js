// api/chat.js — Vercel Serverless Function
// Automatically available at /api/chat (no config needed)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parse body — handle both string and object
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!body?.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: 'Missing messages array' });
  }

  const provider = process.env.PROVIDER || 'gemini';
  const maxTokens = Math.min(body.max_tokens || 950, 1000);

  // ── GOOGLE GEMINI ─────────────────────────────────────────────────
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

    const geminiMessages = body.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const contents = body.system
      ? [
          { role: 'user',  parts: [{ text: body.system }] },
          { role: 'model', parts: [{ text: 'Understood. I will follow those instructions exactly.' }] },
          ...geminiMessages
        ]
      : geminiMessages;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          error: response.status === 429
            ? 'Rate limit hit — please wait 60 seconds and try again.'
            : data.error?.message || 'Gemini API error'
        });
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({
        content: [{ type: 'text', text }],
        model: 'gemini-2.5-flash',
        role: 'assistant'
      });

    } catch (err) {
      return res.status(502).json({ error: 'Gemini proxy error', detail: err.message });
    }
  }

  // ── ANTHROPIC CLAUDE ───────────────────────────────────────────────
  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          system: body.system || '',
          messages: body.messages
        })
      });

      const data = await response.json();
      return res.status(response.status).json(data);

    } catch (err) {
      return res.status(502).json({ error: 'Anthropic proxy error', detail: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown PROVIDER: ${provider}` });
}
