// netlify/functions/chat.js
// Supports both Gemini (free) and Anthropic Claude (paid).
// Switch by changing PROVIDER env variable in Netlify:
//   PROVIDER=gemini     → uses GEMINI_API_KEY
//   PROVIDER=anthropic  → uses ANTHROPIC_API_KEY

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing messages array' })
    };
  }

  const provider = process.env.PROVIDER || 'anthropic';
  const maxTokens = Math.min(body.max_tokens || 950, 1000);

  // ── ANTHROPIC CLAUDE ──────────────────────────────────────────────
  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY in Netlify environment variables' })
      };
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
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

      const data = await res.json();

      if (!res.ok) {
        return {
          statusCode: res.status,
          headers: corsHeaders,
          body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' })
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(data)
      };

    } catch (err) {
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Anthropic proxy error', detail: err.message })
      };
    }
  }

  // ── GOOGLE GEMINI ─────────────────────────────────────────────────
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing GEMINI_API_KEY in Netlify environment variables' })
      };
    }

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
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.7
          }
        })
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          statusCode: res.status,
          headers: corsHeaders,
          body: JSON.stringify({
            error: res.status === 429
              ? 'Rate limit hit — Gemini free tier: 15 req/min. Please wait 60 seconds.'
              : data.error?.message || 'Gemini API error'
          })
        };
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          content: [{ type: 'text', text }],
          model: 'gemini-2.0-flash',
          role: 'assistant'
        })
      };

    } catch (err) {
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Gemini proxy error', detail: err.message })
      };
    }
  }

  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({ error: `Unknown PROVIDER: ${provider}. Set to 'anthropic' or 'gemini'.` })
  };
};
