// api/custom-delivery-enquiry.js
// Sends a custom delivery enquiry to Shane via Telegram (OpenClaw) + email fallback

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, message } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  // Send via Resend to Shane
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'Leveraged Systems <hello@leveragedsystems.com.au>',
        to: ['shane@leveragedsystems.com.au'],
        reply_to: email,
        subject: `Custom Delivery Enquiry — ${name}`,
        html: `
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p>${message ? message.replace(/\n/g, '<br>') : '(no message)'}</p>
        `,
      }),
    });
  }

  return res.status(200).json({ ok: true });
}
