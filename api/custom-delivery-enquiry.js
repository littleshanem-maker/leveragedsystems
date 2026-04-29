// api/custom-delivery-enquiry.js
// Sends a custom delivery / demo enquiry to Shane via Resend.

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, message } = req.body || {};
  const cleanName = name ? String(name).trim() : 'Unknown';
  const cleanEmail = email ? String(email).trim().toLowerCase() : '';
  const cleanMessage = message ? String(message).trim() : '(no message)';

  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY missing — enquiry email not sent');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'Leveraged Systems <hello@leveragedsystems.com.au>',
      to: ['shane@leveragedsystems.com.au'],
      reply_to: cleanEmail,
      subject: `Leveraged Systems enquiry — ${cleanName}`,
      html: `
        <h2>New Leveraged Systems enquiry</h2>
        <p><strong>Name:</strong> ${escapeHtml(cleanName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(cleanMessage).replace(/\n/g, '<br>')}</p>
      `,
      text: `New Leveraged Systems enquiry\n\nName: ${cleanName}\nEmail: ${cleanEmail}\n\nMessage:\n${cleanMessage}`,
    }),
  });

  const resendBody = await resendRes.text();
  if (!resendRes.ok) {
    console.error('Resend email failed:', resendRes.status, resendBody);
    return res.status(502).json({ error: 'Email delivery failed' });
  }

  return res.status(200).json({ ok: true });
}
