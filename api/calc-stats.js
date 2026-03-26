import { kv } from '@vercel/kv';

// Simple auth
const SECRET = process.env.LEADS_SECRET;

function formatAUD(n) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n || 0);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (SECRET) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (token !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get last 7 days of daily counts
    const today = new Date();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `calc:count:${d.toISOString().substring(0, 10)}`;
      const count = await kv.get(key) || 0;
      days.push({ date: d.toISOString().substring(0, 10), count: parseInt(count) });
    }

    // Get last 50 events for stats
    const eventsRaw = await kv.lrange('calc:events', 0, 49);
    const events = eventsRaw.map(e => {
      try { return typeof e === 'string' ? JSON.parse(e) : e; }
      catch { return null; }
    }).filter(Boolean);

    // Stats
    const totalRuns = days.reduce((sum, d) => sum + d.count, 0);
    const avgLoss = events.length
      ? events.reduce((s, e) => s + (e.annualLoss || 0), 0) / events.length
      : 0;
    const highValue = events.filter(e => (e.annualLoss || 0) >= 100000).length;

    // Get calculator leads (email captured)
    const leadsRaw = await kv.lrange('calculator:leads', 0, -1);
    const leads = leadsRaw.map(e => {
      try { return typeof e === 'string' ? JSON.parse(e) : e; }
      catch { return null; }
    }).filter(Boolean);
    const recentLeads = leads.slice(0, 10);

    return res.status(200).json({
      dailyCounts: days,
      totalRunsLast7Days: totalRuns,
      avgAnnualLoss: avgLoss,
      highValueRuns: highValue,
      emailLeadsTotal: leads.length,
      recentLeads,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
