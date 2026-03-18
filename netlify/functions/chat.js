// netlify/functions/chat.js
// Standard Netlify serverless function — no Deno, no edge runtime needed.
// Automatically available at /.netlify/functions/chat

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing GEMINI_API_KEY — set it in Netlify environment variables' })
    };
  }

  const maxTokens = Math.min(body.max_tokens || 950, 1000);

  // Convert Anthropic format → Gemini format
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
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
            ? 'Rate limit hit — Gemini free tier allows 15 requests/minute. Please wait and retry.'
            : data.error?.message || 'Gemini API error'
        })
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Return in Anthropic shape so frontend works unchanged
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [{ type: 'text', text }],
        model: 'gemini-1.5-flash',
        role: 'assistant'
      })
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Proxy error', detail: err.message })
    };
  }
};
