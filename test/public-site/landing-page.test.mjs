import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('landing page has the new headline and company voice', () => {
  assert.match(html, /Get paid for every variation/i);
  assert.match(html, /We help construction businesses run on AI/);
  assert.doesNotMatch(html, /Shane Little|Who's behind it/);
});

test('every discovery button emails Shane', () => {
  const buttons = html.match(/<a[^>]*>Book a discovery chat/g) ?? [];
  assert.ok(buttons.length >= 1);
  for (const b of buttons) assert.match(b, /href="mailto:shane@leveragedsystems\.com\.au\?subject=Discovery%20chat"/);
});

test('no prices, ABN placeholder or draft tags', () => {
  assert.doesNotMatch(html, /\$\s?\d|A\$|\[ABN\]|\[email\]|wording to confirm|OPTIONAL/);
});

test('logo is self-hosted, favicons and SEO files kept', async () => {
  assert.doesNotMatch(html, /src="data:image/);
  assert.match(html, /src="\/images\/logo-nav\.png"/);
  assert.match(html, /rel="icon"[^>]*\/favicon\.png/);
  assert.match(html, /rel="apple-touch-icon"/);
  await access(new URL('../../sitemap.xml', import.meta.url));
  await access(new URL('../../robots.txt', import.meta.url));
});
