import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The landing page is site v2 (Oct 2026): one page, one action (book a
// 20-minute chat), no public pricing. Demo figures in the hero mock-up are
// sample data, not prices.

test('public landing page leads with the AI-for-construction offer and no public price', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<title>Leveraged Systems \| AI admin for Australian construction businesses<\/title>/);
  assert.match(html, /<meta name="description" content="I build AI into the tools you already use/);
  assert.match(html, /AI that runs the <em>admin<\/em> in your construction business/);
  assert.match(html, /How does pricing work\?/);
  assert.doesNotMatch(html, /A\$|AUD|\+ GST/);
  assert.doesNotMatch(html, /Commercial Control Assessment|30-Day Job Sprint/);
});

test('landing page follows v2 section order', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const order = ['The work\'s good. The admin is eating the margin.', 'Three admin jobs I take off your plate first', 'You sign off. AI does the admin.', 'Three steps, no big rollout', 'Built for owners running', 'Built by someone who\'s run construction jobs', 'Common questions', 'See what could run on AI in your business.'];
  const idx = order.map((s) => html.indexOf(s));
  idx.forEach((i, n) => assert.ok(i > -1, `missing: ${order[n]}`));
  for (let n = 1; n < idx.length; n += 1) assert.ok(idx[n - 1] < idx[n], `${order[n - 1]} should come before ${order[n]}`);
});

test('Variation Shield screenshot asset is unchanged for its own page', async () => {
  const screenshot = await readFile(path.join(root, 'images', 'variation-shield-dashboard.png'));
  assert.equal(screenshot.readUInt32BE(16), 1280);
  assert.equal(screenshot.readUInt32BE(20), 927);
  assert.equal(
    createHash('sha256').update(screenshot).digest('hex'),
    'ceab7346fd7eb3a357d34ff65a544967a22c1cb23157560402dd6432dfbe9ee7',
  );
});
