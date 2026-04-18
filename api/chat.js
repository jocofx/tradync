export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, system } = req.body || {};
  if (!messages || !system) return res.status(400).json({ error: 'Missing messages or system' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel' });

  console.log('API Key prefix:', apiKey.slice(0, 20));
  console.log('Messages count:', messages.length);

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
        max_tokens: 1024,
        system: system,
        messages: messages
      })
    });

    const data = await response.json();
    console.log('Anthropic status:', response.status);
    console.log('Anthropic response type:', data.type);
    if (data.error) console.log('Anthropic error:', JSON.stringify(data.error));

    return res.status(200).json(data);
  } catch (e) {
    console.error('Fetch error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
