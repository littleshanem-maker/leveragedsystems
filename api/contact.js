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

  const { email, name, message: userMessage } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  if (!userMessage || userMessage.trim().length < 2) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const contact = {
    email: email.toLowerCase().trim(),
    name: name ? name.trim() : null,
    message: userMessage.trim(),
    timestamp,
    source: 'leveragedsystems.com.au',
  };

  // Store in Vercel KV (graceful fallback if not configured)
  let kvStored = false;
  try {
    await kv.set(`contact:${timestamp}`, contact);
    await kv.lpush('contact:all', JSON.stringify(contact));
    kvStored = true;
  } catch (kvErr) {
    console.warn('KV not configured or error:', kvErr.message);
  }

  // Truncate long messages for Telegram
  const preview = contact.message.length > 300
    ? contact.message.slice(0, 300) + '…'
    : contact.message;

  const nameStr = contact.name || 'Unknown';
  const timeStr = formatAEDT(now);
  const tgMessage =
    `📬 New contact form submission!\n👤 Name: ${nameStr}\n📧 Email: ${contact.email}\n💬 Message: ${preview}\n🕐 Time: ${timeStr}` +
    (kvStored ? '' : '\n⚠️ Note: KV not configured, lead not stored');

  try {
    await sendTelegram(tgMessage);
  } catch (tgErr) {
    console.error('Telegram error:', tgErr.message);
  }

  return res.status(200).json({ success: true });
}
