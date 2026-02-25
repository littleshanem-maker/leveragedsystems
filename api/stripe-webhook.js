// api/stripe-webhook.js
// Stripe webhook handler — fires on successful Variation Shield payment
// Triggers: welcome email via Resend + Telegram ping to Shane
//
// Required env vars (set in Vercel dashboard):
//   STRIPE_WEBHOOK_SECRET   — from Stripe Developers → Webhooks → signing secret
//   RESEND_API_KEY          — from resend.com dashboard

import crypto from 'crypto';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8005952496:AAG488afZIu0wn89rkWKoCSZfCRnTNhKjUI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5969383077';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ─── Stripe signature verification ────────────────────────────────────────────
function verifyStripeSignature(rawBody, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;

  // Reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  });
}

// ─── Welcome email via Resend ──────────────────────────────────────────────────
async function sendWelcomeEmail(toEmail, toName) {
  const firstName = toName ? toName.split(' ')[0] : 'there';

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a; font-size: 16px; line-height: 1.6;">

  <p>G'day ${firstName},</p>

  <p>Welcome to Variation Shield — you're one of our founding customers, which means you get a personal 30-minute setup call with me.</p>

  <p><strong>First step — create your account here:</strong><br>
  <a href="https://app.leveragedsystems.com.au" style="color: #2563eb;">app.leveragedsystems.com.au</a></p>

  <p>Once you're in:</p>
  <ol>
    <li>Add your first project (takes 2 minutes)</li>
    <li>Invite your site supervisor or leading hand</li>
    <li>Capture a test variation together before the real ones come in</li>
  </ol>

  <p>The goal before our setup call is to have at least one project set up and your team access sorted. That way we spend the 30 minutes on real workflow, not setup.</p>

  <p><strong>Reply to this email with 2–3 times that work for your setup call this week.</strong></p>

  <p>Any questions in the meantime — just reply here. I read these personally.</p>

  <p>Shane<br>
  Founder, Leveraged Systems<br>
  <a href="https://leveragedsystems.com.au" style="color: #2563eb;">leveragedsystems.com.au</a></p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
  <p style="font-size: 13px; color: #6b7280;">
    You're receiving this because you signed up for Variation Shield ($499/month).<br>
    Manage your subscription at <a href="https://billing.stripe.com" style="color: #6b7280;">billing.stripe.com</a>.
  </p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Shane Little <hello@leveragedsystems.com.au>',
      to: [toEmail],
      subject: 'Welcome to Variation Shield — here\'s how to get started',
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

// ─── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body
  const rawBody = await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

  // Verify Stripe signature
  const signature = req.headers['stripe-signature'];
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  if (!verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET)) {
    console.error('Invalid Stripe signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);
  console.log(`Stripe event received: ${event.type}`);

  // ── Payment succeeded ──────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || '';
    const amountPaid = ((session.amount_total || 0) / 100).toFixed(2);
    const currency = (session.currency || 'aud').toUpperCase();

    if (!customerEmail) {
      console.error('No customer email in event');
      return res.status(200).json({ received: true }); // Still 200 to Stripe
    }

    // Send welcome email
    if (RESEND_API_KEY) {
      try {
        await sendWelcomeEmail(customerEmail, customerName);
        console.log(`Welcome email sent to ${customerEmail}`);
      } catch (err) {
        console.error('Welcome email failed:', err.message);
        // Don't fail the webhook — log and continue
      }
    } else {
      console.warn('RESEND_API_KEY not set — email not sent');
    }

    // Ping Shane on Telegram
    const nameStr = customerName ? `\n👤 <b>${customerName}</b>` : '';
    await sendTelegram(
      `💰 <b>NEW CUSTOMER — Variation Shield</b>${nameStr}\n📧 ${customerEmail}\n💵 ${currency} $${amountPaid}/mo\n\n` +
      `<b>Action:</b> Book their onboarding call — reply to their welcome email.\n\n` +
      `🔗 Stripe: https://dashboard.stripe.com/customers`
    );
  }

  // ── Subscription cancelled ─────────────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await sendTelegram(
      `⚠️ <b>CANCELLATION — Variation Shield</b>\n` +
      `Stripe subscription ID: ${sub.id}\n` +
      `Ended: ${new Date(sub.ended_at * 1000).toLocaleDateString('en-AU')}\n\n` +
      `Check Stripe dashboard for customer details.`
    );
  }

  // ── Payment failed (retry) ─────────────────────────────────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const attempt = invoice.attempt_count;
    if (attempt >= 2) {
      await sendTelegram(
        `⚠️ <b>PAYMENT FAILED (attempt ${attempt})</b>\n` +
        `Customer: ${invoice.customer_email || 'unknown'}\n` +
        `Amount: $${((invoice.amount_due || 0) / 100).toFixed(2)}\n\n` +
        `Stripe will retry automatically. Monitor for churn risk.`
      );
    }
  }

  return res.status(200).json({ received: true });
}
