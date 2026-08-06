import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('public Sprint offer keeps focused implementation without a 30-day commitment', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const sprintSection = html.match(/<section class="audit-section sprint-section" id="sprint">[\s\S]*?<\/section>/);

  assert.ok(sprintSection, 'Sprint offer section should remain present');
  assert.match(sprintSection[0], /<div class="section-eyebrow">Focused implementation<\/div>/);
  assert.match(sprintSection[0], /<h2>30-Day Commercial Control Sprint<\/h2>/);
  assert.match(sprintSection[0], /One workflow\. One primary failure point\. One working control\./);
  assert.doesNotMatch(sprintSection[0], /AUD \$5,000/);
  assert.doesNotMatch(sprintSection[0], /founding clients/i);
  assert.match(html, /<p class="assessment-price">AUD \$950 <span>\+ GST<\/span><\/p>/);
  assert.doesNotMatch(html, /id="sprint-commitment-title"/);
  assert.doesNotMatch(html, /30-Day Implementation Commitment/);
  assert.doesNotMatch(html, /not ready for use by Day 30 because of a Leveraged Systems defect/);
  assert.doesNotMatch(html, /\.audit-guarantee\b/);
});

test('Variation Shield software visual remains in its offer section', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const screenshot = await readFile(path.join(root, 'images', 'variation-shield-dashboard.png'));
  const productsSection = html.match(/<section class="products-section" id="products">[\s\S]*?<\/section>/);

  assert.ok(productsSection, 'Variation Shield offer section should remain present');
  assert.match(productsSection[0], /<div class="vs-dashboard-wrap reveal">/);
  assert.match(productsSection[0], /<img class="vs-product-screenshot"/);
  assert.match(productsSection[0], /src="images\/variation-shield-dashboard\.png"/);
  assert.match(productsSection[0], /width="1280" height="927"/);
  assert.match(productsSection[0], /alt="Variation Shield executive risk overview dashboard/);
  assert.doesNotMatch(productsSection[0], /West Gate Extension - Variations/);
  assert.equal(screenshot.readUInt32BE(16), 1280);
  assert.equal(screenshot.readUInt32BE(20), 927);
  assert.equal(
    createHash('sha256').update(screenshot).digest('hex'),
    'ceab7346fd7eb3a357d34ff65a544967a22c1cb23157560402dd6432dfbe9ee7',
  );
});

test('public site leads with the Assessment while preserving the offer hierarchy', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<title>AI &amp; Workflow Assessment \| Leveraged Systems<\/title>/);
  assert.match(html, /Clarity before commitment\./);
  assert.match(html, /Find the one workflow worth improving/);
  assert.match(html, /ready-to-run four-day test plan/);
  assert.match(html, /id="assessment"/);
  assert.match(html, /id="diagnostic"/);
  assert.ok(html.indexOf('id="assessment"') < html.indexOf('id="sprint"'));
  assert.ok(html.indexOf('id="sprint"') < html.indexOf('id="products"'));
});

test('public enquiry form captures offer interest and keeps the problem note optional', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<select id="cf-offer" required>/);
  assert.match(html, /<option value="assessment" selected>AI &amp; Workflow Assessment<\/option>/);
  assert.match(html, /<option value="sprint">30-Day Commercial Control Sprint<\/option>/);
  assert.match(html, /<option value="variation-shield">Variation Shield<\/option>/);
  assert.match(html, /<textarea id="cf-improve"[^>]*><\/textarea>/);
  assert.doesNotMatch(html, /<textarea id="cf-improve"[^>]*required/);
  assert.match(html, /data-offer="assessment"/);
  assert.match(html, /data-offer="sprint"/);
  assert.match(html, /data-offer="variation-shield"/);
});
