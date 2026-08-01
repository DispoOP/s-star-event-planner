// Vercel serverless function — deploy at /api/proxy.js
//
// This is the piece that was actually missing. The frontend used to call
// api.anthropic.com directly with no key attached — that only works inside
// Claude.ai's own artifact preview, never on a real deployed site. This
// function is the real fix: it holds your Anthropic key server-side and
// forwards the request, so the key is never exposed to visitors.
//
// SETUP:
// Vercel → Settings → Environment Variables, add:
//   ANTHROPIC_API_KEY = your key from console.anthropic.com

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured with ANTHROPIC_API_KEY' });
  }

  const { model, max_tokens, system, messages } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'messages is required' });

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: max_tokens || 300,
        system,
        messages,
      }),
    });

    const data = await anthropicRes.json();
    // Pass Anthropic's response straight through — the frontend already
    // knows how to parse this exact shape (data.content[].text).
    return res.status(anthropicRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Proxy request failed' });
  }
}
