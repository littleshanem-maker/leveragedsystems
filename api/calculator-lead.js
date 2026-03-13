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
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true, timeZoneName: 'short',
  });
}

function fmtAUD(n) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  });
  if (!res.ok) throw new Error(`Telegram error: ${await res.text()}`);
}

export default async function handler(req, res) {
  setCORSHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, company, revenue, variationRate, unrecoveredRate, annualLoss, recoverable } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const now = new Date();
  const timestamp = now.toISOString();

  const lead = {
    email: email.toLowerCase().trim(),
    name: name ? name.trim() : null,
    company: company ? company.trim() : null,
    revenue: revenue ? parseInt(revenue) : null,
    variationRate: variationRate ? parseFloat(variationRate) : null,
    unrecoveredRate: unrecoveredRate ? parseFloat(unrecoveredRate) : null,
    annualLoss: annualLoss ? parseFloat(annualLoss) : null,
    recoverable: recoverable ? parseFloat(recoverable) : null,
    timestamp,
    source: 'calculator',
  };

  let kvStored = false;
  try {
    await kv.set(`calculator:${timestamp}`, lead);
    await kv.lpush('calculator:all', JSON.stringify(lead));
    kvStored = true;
  } catch (err) {
    console.warn('KV error:', err.message);
  }

  // Build Telegram message — hot lead context front and centre
  const timeStr = formatAEDT(now);
  const nameStr = lead.name ? ` — ${lead.name}` : '';
  const companyStr = lead.company ? `\n🏢 Company: ${lead.company}` : '';
  const leakageStr = lead.annualLoss ? `\n💸 Their leakage: <b>${fmtAUD(lead.annualLoss)}/yr</b>` : '';
  const recoverableStr = lead.recoverable ? `\n✅ Recoverable: ${fmtAUD(lead.recoverable)}/yr` : '';
  const revenueStr = lead.revenue ? `\n📊 Revenue: ${fmtAUD(lead.revenue)} | Var rate: ${(lead.variationRate * 100).toFixed(0)}% | Unagreed: ${(lead.unrecoveredRate * 100).toFixed(0)}%` : '';

  const message =
    `🔥 <b>Calculator Lead${nameStr}</b>\n` +
    `📧 ${lead.email}` +
    companyStr +
    leakageStr +
    recoverableStr +
    revenueStr +
    `\n🕐 ${timeStr}\n` +
    `<a href="https://leveragedsystems.com.au/schedule">→ Book them a demo</a>` +
    (kvStored ? '' : '\n⚠️ KV not configured, lead not stored');

  try {
    await sendTelegram(message);
  } catch (err) {
    console.error('Telegram error:', err.message);
  }

  return res.status(200).json({ success: true });
}
