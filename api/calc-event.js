import { kv } from '@vercel/kv';

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://leveragedsystems.com.au');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { revenue, variationRate, unrecoveredRate, annualLoss, recoverable } = req.body || {};

    const event = {
      ts: new Date().toISOString(),
      revenue: revenue || 0,
      variationRate: variationRate || 0,
      unrecoveredRate: unrecoveredRate || 0,
      annualLoss: annualLoss || 0,
      recoverable: recoverable || 0,
    };

    // Store in KV list
    await kv.lpush('calc:events', JSON.stringify(event));
    // Keep last 500 events only
    await kv.ltrim('calc:events', 0, 499);

    // Increment daily counter
    const dayKey = `calc:count:${new Date().toISOString().substring(0, 10)}`;
    await kv.incr(dayKey);
    await kv.expire(dayKey, 60 * 60 * 24 * 90); // keep 90 days

    return res.status(200).json({ ok: true });
  } catch (err) {
    // Fail silently — never break the calculator
    console.error('calc-event error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
