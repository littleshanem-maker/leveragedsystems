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

  const { email, name, company, phone, business, improve, contactMethod, message: userMessage } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const messageBody = improve || userMessage || '';
  if (messageBody.trim().length < 2) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const contact = {
    email: email.toLowerCase().trim(),
    name: name ? name.trim() : null,
    company: company ? company.trim() : null,
    phone: phone ? phone.trim() : null,
    business: business ? business.trim() : null,
    improve: messageBody.trim(),
    contactMethod: contactMethod || null,
    timestamp,
    source: 'leveragedsystems.com.au / workflow-review',
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
  const preview = contact.improve.length > 300
    ? contact.improve.slice(0, 300) + '…'
    : contact.improve;

  const nameStr = contact.name || 'Unknown';
  const companyStr = contact.company ? `\n🏢 Company: ${contact.company}` : '';
  const phoneStr = contact.phone ? `\n📱 Phone: ${contact.phone}` : '';
  const businessStr = contact.business ? `\n🏷️ Business: ${contact.business}` : '';
  const contactMethodStr = contact.contactMethod ? `\n📞 Preferred: ${contact.contactMethod}` : '';
  const timeStr = formatAEDT(now);
  const tgMessage =
    `📬 New workflow review request!\n👤 Name: ${nameStr}${companyStr}\n📧 Email: ${contact.email}${phoneStr}${businessStr}\n💬 What they want to improve:\n${preview}${contactMethodStr}\n🕐 Time: ${timeStr}` +
    (kvStored ? '' : '\n⚠️ Note: KV not configured, lead not stored');

  try {
    await sendTelegram(tgMessage);
  } catch (tgErr) {
    console.error('Telegram error:', tgErr.message);
  }

  return res.status(200).json({ success: true });
}
