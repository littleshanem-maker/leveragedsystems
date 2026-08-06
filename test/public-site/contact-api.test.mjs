import assert from 'node:assert/strict';
import test from 'node:test';

function createResponse() {
  const output = { headers: {} };
  const response = {
    setHeader(name, value) {
      output.headers[name] = value;
    },
    status(code) {
      output.status = code;
      return response;
    },
    json(body) {
      output.body = body;
      return response;
    },
    end() {
      return response;
    },
  };
  return { output, response };
}

test('Assessment enquiry accepts an optional problem note and records offer interest', { concurrency: false }, async () => {
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  let emailPayload;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    emailPayload = JSON.parse(options.body);
    return { ok: true, text: async () => '' };
  };

  try {
    const { default: handler } = await import('../../api/contact.js?assessment-enquiry');
    const { output, response } = createResponse();

    await handler({
      method: 'POST',
      body: {
        email: 'director@example.com',
        name: 'Pat Builder',
        company: 'Builder & Co',
        offerInterest: 'assessment',
        improve: '',
        contactMethod: 'email',
      },
    }, response);

    assert.equal(output.status, 200);
    assert.deepEqual(output.body, { success: true });
    assert.match(emailPayload.subject, /New AI & Workflow Assessment enquiry/);
    assert.match(emailPayload.html, /<strong>Offer:<\/strong> AI &amp; Workflow Assessment/);
    assert.match(emailPayload.html, /No problem note provided/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('enquiry rejects unknown and inherited offer preferences', { concurrency: false }, async () => {
  const { default: handler } = await import('../../api/contact.js?invalid-offer');

  for (const offerInterest of ['everything', 'toString']) {
    const { output, response } = createResponse();

    await handler({
      method: 'POST',
      body: {
        email: 'director@example.com',
        offerInterest,
        improve: '',
      },
    }, response);

    assert.equal(output.status, 400);
    assert.deepEqual(output.body, { error: 'Valid offer interest required' });
  }
});

test('legacy enquiries with a message resolve to the Sprint', { concurrency: false }, async () => {
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  let emailPayload;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    emailPayload = JSON.parse(options.body);
    return { ok: true, text: async () => '' };
  };

  try {
    const { default: handler } = await import('../../api/contact.js?legacy-enquiry');
    const { output, response } = createResponse();

    await handler({
      method: 'POST',
      body: {
        email: 'legacy@example.com',
        message: 'We need better visibility across our projects.',
      },
    }, response);

    assert.equal(output.status, 200);
    assert.match(emailPayload.subject, /New 30-Day Commercial Control Sprint enquiry/);
    assert.match(emailPayload.html, /We need better visibility across our projects/);

    const emptyEnquiry = createResponse();
    await handler({
      method: 'POST',
      body: {
        email: 'legacy@example.com',
        message: ' ',
      },
    }, emptyEnquiry.response);

    assert.equal(emptyEnquiry.output.status, 400);
    assert.deepEqual(emptyEnquiry.output.body, { error: 'Valid offer interest required' });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('each selected offer uses its correct client-facing label', { concurrency: false }, async () => {
  const offers = [
    ['assessment', 'AI & Workflow Assessment'],
    ['sprint', '30-Day Commercial Control Sprint'],
    ['variation-shield', 'Variation Shield'],
  ];
  const originalFetch = globalThis.fetch;

  try {
    for (const [offerInterest, offerLabel] of offers) {
      process.env.RESEND_API_KEY = 'test-key';
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;

      let emailPayload;
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.resend.com/emails');
        emailPayload = JSON.parse(options.body);
        return { ok: true, text: async () => '' };
      };

      const { default: handler } = await import(`../../api/contact.js?offer-${offerInterest}`);
      const { output, response } = createResponse();
      await handler({
        method: 'POST',
        body: {
          email: 'director@example.com',
          offerInterest,
        },
      }, response);

      assert.equal(output.status, 200);
      assert.equal(emailPayload.subject, `New ${offerLabel} enquiry — director@example.com`);
      assert.match(emailPayload.html, new RegExp(`<strong>Offer:<\\/strong> ${offerLabel.replace('&', '&amp;')}`));
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
});
