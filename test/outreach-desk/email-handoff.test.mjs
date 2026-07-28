import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMailtoUri } from '../../internal/outreach-desk/lib/email-handoff.mjs';

test('builds an RFC 6068 handoff that preserves reviewed Unicode and reserved characters', () => {
  const uri = buildMailtoUri({
    recipient: 'morgan@example.com',
    subject: 'Variation records & next steps?',
    body: 'Hi Morgan,\n\nWould Thursday at 2:00 work? Café project #4 is the example.\n\nShane',
  });
  assert.match(uri, /^mailto:morgan%40example\.com\?/);
  const parsed = new URL(uri);
  assert.equal(decodeURIComponent(parsed.pathname), 'morgan@example.com');
  assert.equal(parsed.searchParams.get('subject'), 'Variation records & next steps?');
  assert.equal(parsed.searchParams.get('body'), 'Hi Morgan,\n\nWould Thursday at 2:00 work? Café project #4 is the example.\n\nShane');
});

test('rejects invalid recipients and blank subjects without creating a handoff', () => {
  assert.throws(() => buildMailtoUri({ recipient: 'not-an-email', subject: 'Hello', body: 'Body' }), /valid recipient/i);
  assert.throws(() => buildMailtoUri({ recipient: 'a@example.com', subject: ' ', body: 'Body' }), /subject/i);
});
