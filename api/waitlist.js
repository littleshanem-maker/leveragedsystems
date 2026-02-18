import { kv } from '@vercel/kv';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8005952496:AAG488afZIu0wn89rkWKoCSZfCRnTNhKjUI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5969383077';

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://leveragedsystems.com.au');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatAEDT(date) {
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram error: ${err}`);
  }
}

export default async function handler(req, res) {
  setCORSHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const lead = {
    email: email.toLowerCase().trim(),
    name: name ? name.trim() : null,
    timestamp,
    source: 'leveragedsystems.com.au',
  };

  // Store in Vercel KV (graceful fallback if not configured)
  let kvStored = false;
  try {
    await kv.set(`waitlist:${timestamp}`, lead);
    // Also add to sorted list for easy retrieval
    await kv.lpush('waitlist:all', JSON.stringify(lead));
    kvStored = true;
  } catch (kvErr) {
    console.warn('KV not configured or error:', kvErr.message);
    // Continue — Telegram notification still goes out
  }

  // Send Telegram notification
  const timeStr = formatAEDT(now);
  const nameStr = lead.name ? `\n👤 Name: ${lead.name}` : '';
  const message =
    `🔔 New waitlist signup!${nameStr}\n📧 Email: ${lead.email}\n🕐 Time: ${timeStr}\n📍 Source: leveragedsystems.com.au` +
    (kvStored ? '' : '\n⚠️ Note: KV not configured, lead not stored');

  try {
    await sendTelegram(message);
  } catch (tgErr) {
    console.error('Telegram error:', tgErr.message);
    // Don't fail the request just because Telegram had an issue
  }

  return res.status(200).json({ success: true });
}
