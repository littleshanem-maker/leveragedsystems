import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The landing page was redesigned (option C, Oct 2026): one page, one action
// (book a discovery chat), no public pricing. Old Assessment/Sprint/Variation
// Shield sections and the enquiry form were removed from index.html.

test('public landing page leads with the AI-for-construction offer and no public price', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<title>Leveraged Systems \| AI admin for construction &amp; trade businesses<\/title>/);
  assert.match(html, /<meta name="description" content="Stop losing money on variations, claims and paperwork\. We set up AI/);
  assert.match(html, /AI that runs the admin in your construction business/);
  assert.match(html, /How does pricing work\?/);
  assert.doesNotMatch(html, /\$\s?\d|AUD|\+ GST/);
  assert.doesNotMatch(html, /Commercial Control Assessment|30-Day Job Sprint/);
});

test('landing page follows problems, fix, steps, examples, FAQ, CTA order', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const order = ['Good work. Leaky admin.', 'We learn how you run', 'How it works', 'The kind of thing we build', 'Questions', 'Book a no-pressure chat'];
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
