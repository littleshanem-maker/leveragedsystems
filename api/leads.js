import { kv } from '@vercel/kv';

// Simple auth — check for a secret token in the Authorization header
// Set LEADS_SECRET env var in Vercel dashboard to protect this endpoint
const LEADS_SECRET = process.env.LEADS_SECRET;

export default async function handler(req, res) {
  // CORS — allow same-origin and dashboard access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional auth check
  if (LEADS_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== LEADS_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Fetch waitlist leads
    const waitlistRaw = await kv.lrange('waitlist:all', 0, -1);
    const waitlist = waitlistRaw.map((item) => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return item;
      }
    });

    // Fetch contact submissions
    const contactsRaw = await kv.lrange('contact:all', 0, -1);
    const contacts = contactsRaw.map((item) => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return item;
      }
    });

    return res.status(200).json({
      waitlist,
      contacts,
      meta: {
        waitlistCount: waitlist.length,
        contactCount: contacts.length,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('KV error:', err.message);
    return res.status(500).json({
      error: 'KV not configured or unavailable',
      waitlist: [],
      contacts: [],
    });
  }
}
