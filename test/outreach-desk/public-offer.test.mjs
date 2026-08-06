import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('public Sprint offer displays the bounded 30-day implementation commitment', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /id="sprint-commitment-title"/);
  assert.match(html, /not ready for use by Day 30 because of a Leveraged Systems defect against the written acceptance conditions/);
  assert.match(html, /at no additional professional fee until it is ready for use/);
  assert.match(html, /client-requested changes/);
  assert.match(html, /financial, variation, legal, contractual, compliance, dispute or approval outcomes/);
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
