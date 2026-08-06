import { kv } from '@vercel/kv';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OFFER_LABELS = {
  assessment: 'AI & Workflow Assessment',
  sprint: '30-Day Commercial Control Sprint',
  'variation-shield': 'Variation Shield',
};

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://leveragedsystems.com.au');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeTelegramHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram delivery is not configured');
  }

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

async function sendEmail(contact) {
  if (!RESEND_API_KEY) {
    throw new Error('Email delivery is not configured');
  }

  const subjectName = (contact.name || contact.company || contact.email)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 120);
  const htmlRows = [
    ['Offer', contact.offerLabel],
    ['Name', contact.name || 'Unknown'],
    ['Company', contact.company],
    ['Email', contact.email],
    ['Phone', contact.phone],
    ['Business / trade', contact.business],
    ['Preferred contact method', contact.contactMethod],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeTelegramHtml(value)}</p>`)
    .join('');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Leveraged Systems <hello@leveragedsystems.com.au>',
      to: ['shane@leveragedsystems.com.au'],
      reply_to: contact.email,
      subject: `New ${contact.offerLabel} enquiry — ${subjectName}`,
      html: `
        <h2>New ${escapeTelegramHtml(contact.offerLabel)} enquiry</h2>
        ${htmlRows}
        <p><strong>Current problem note:</strong></p>
        <p>${escapeTelegramHtml(contact.improve || 'No problem note provided').replace(/\n/g, '<br>')}</p>
      `,
      text: [
        `New ${contact.offerLabel} enquiry`,
        '',
        `Offer: ${contact.offerLabel}`,
        `Name: ${contact.name || 'Unknown'}`,
        contact.company ? `Company: ${contact.company}` : null,
        `Email: ${contact.email}`,
        contact.phone ? `Phone: ${contact.phone}` : null,
        contact.business ? `Business / trade: ${contact.business}` : null,
        contact.contactMethod ? `Preferred contact method: ${contact.contactMethod}` : null,
        '',
        'Current problem note:',
        contact.improve || 'No problem note provided',
      ].filter(value => value !== null).join('\n'),
    }),
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed with status ${response.status}`);
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

  const {
    email,
    name,
    company,
    phone,
    business,
    improve,
    offerInterest,
    contactMethod,
    message: userMessage,
  } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const messageBody = improve || userMessage || '';
  const requestedOffer = typeof offerInterest === 'string' ? offerInterest.trim() : '';
  if (requestedOffer && !Object.hasOwn(OFFER_LABELS, requestedOffer)) {
    return res.status(400).json({ error: 'Valid offer interest required' });
  }

  // Keep older form submissions working while requiring a clear offer from the new form.
  const resolvedOffer = requestedOffer || (messageBody.trim().length >= 2 ? 'sprint' : '');
  if (!resolvedOffer) {
    return res.status(400).json({ error: 'Valid offer interest required' });
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const contact = {
    email: email.toLowerCase().trim(),
    name: name ? name.trim() : null,
    company: company ? company.trim() : null,
    phone: phone ? phone.trim() : null,
    business: business ? business.trim() : null,
    improve: messageBody.trim() || null,
    offerInterest: resolvedOffer,
    offerLabel: OFFER_LABELS[resolvedOffer],
    contactMethod: contactMethod || null,
    timestamp,
    source: `leveragedsystems.com.au / ${resolvedOffer}-enquiry`,
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
  const problemNote = contact.improve || 'No problem note provided';
  const preview = escapeTelegramHtml(problemNote.length > 300
    ? problemNote.slice(0, 300) + '…'
    : problemNote);

  const nameStr = escapeTelegramHtml(contact.name || 'Unknown');
  const companyStr = contact.company ? `\n🏢 Company: ${escapeTelegramHtml(contact.company)}` : '';
  const phoneStr = contact.phone ? `\n📱 Phone: ${escapeTelegramHtml(contact.phone)}` : '';
  const businessStr = contact.business ? `\n🏷️ Business: ${escapeTelegramHtml(contact.business)}` : '';
  const contactMethodStr = contact.contactMethod ? `\n📞 Preferred: ${escapeTelegramHtml(contact.contactMethod)}` : '';
  const timeStr = formatAEDT(now);
  const tgMessage =
    `📬 New ${escapeTelegramHtml(contact.offerLabel)} enquiry!\n🎯 Offer: ${escapeTelegramHtml(contact.offerLabel)}\n👤 Name: ${nameStr}${companyStr}\n📧 Email: ${escapeTelegramHtml(contact.email)}${phoneStr}${businessStr}\n💬 Current problem note:\n${preview}${contactMethodStr}\n🕐 Time: ${timeStr}` +
    (kvStored ? '' : '\n⚠️ Note: KV not configured, lead not stored');

  let telegramSent = false;
  try {
    await sendTelegram(tgMessage);
    telegramSent = true;
  } catch (tgErr) {
    console.error('Telegram error:', tgErr.message);
  }

  let emailSent = false;
  if (!telegramSent) {
    try {
      await sendEmail(contact);
      emailSent = true;
    } catch (emailErr) {
      console.error('Email error:', emailErr.message);
    }
  }

  if (!kvStored && !telegramSent && !emailSent) {
    return res.status(503).json({ error: 'Enquiry delivery is temporarily unavailable' });
  }

  return res.status(200).json({ success: true });
}
