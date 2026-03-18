// netlify/edge-functions/claude-proxy.js

export default async (request, context) => {

  // Only allow POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Allow all *.netlify.app previews + your live domain
  const origin = request.headers.get('origin') || '';
  const isAllowed =
    origin.endsWith('.netlify.app') ||
    origin === 'https://whoispaying.com' ||
    origin === 'https://www.whoispaying.com';

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Forbidden', origin }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders
    });
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: 'Missing messages array' }), {
      status: 400, headers: corsHeaders
    });
  }

  // Read env vars set in Netlify dashboard
  const provider = Deno.env.get('PROVIDER') || 'gemini';
  const maxTokens = Math.min(body.max_tokens || 950, 1000);

  // ── GOOGLE GEMINI ──────────────────────────────────────────────────
  if (provider === 'gemini') {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY env variable' }), {
        status: 500, headers: corsHeaders
      });
    }

    // Convert Anthropic message format → Gemini format
    const geminiMessages = body.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Inject system prompt as opening exchange
    const contents = body.system
      ? [
          { role: 'user',  parts: [{ text: body.system }] },
          { role: 'model', parts: [{ text: 'Understood. I will follow those instructions exactly.' }] },
          ...geminiMessages
        ]
      : geminiMessages;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
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
        return new Response(JSON.stringify({ error: data.error?.message || 'Gemini API error' }), {
          status: res.status, headers: corsHeaders
        });
      }

      // Normalise to Anthropic response shape so frontend works identically
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return new Response(JSON.stringify({
        content: [{ type: 'text', text }],
        model: 'gemini-1.5-flash',
        role: 'assistant'
      }), { status: 200, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Gemini proxy error', detail: err.message }), {
        status: 502, headers: corsHeaders
      });
    }
  }

  // ── ANTHROPIC CLAUDE ───────────────────────────────────────────────
  if (provider === 'anthropic') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY env variable' }), {
        status: 500, headers: corsHeaders
      });
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
      return new Response(JSON.stringify(data), {
        status: res.status, headers: corsHeaders
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Anthropic proxy error', detail: err.message }), {
        status: 502, headers: corsHeaders
      });
    }
  }

  return new Response(JSON.stringify({ error: `Unknown PROVIDER: ${provider}` }), {
    status: 400, headers: corsHeaders
  });
};

export const config = { path: '/api/chat' };
