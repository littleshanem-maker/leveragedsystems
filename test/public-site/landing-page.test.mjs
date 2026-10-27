import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('landing page has the v2 headline and voice', () => {
  assert.match(html, /<h1>AI that runs the <em>admin<\/em> in your construction business\.<\/h1>/);
  assert.match(html, /Quotes drafted, progress claims and invoices out on time, and the follow-ups chased\. I build it into the tools you already use\. You sign off, AI does the admin\./);
  assert.match(html, /For owners of Australian construction businesses, \$1M–\$20M/);
  assert.doesNotMatch(html, /Get paid for every variation/i);
});

test('every chat button emails Shane', () => {
  const buttons = html.match(/<a[^>]*>(?:<span class="long">)?Book a 20-minute chat/g) ?? [];
  assert.ok(buttons.length >= 3);
  const mailtos = html.match(/href="mailto:[^"]*"/g) ?? [];
  for (const m of mailtos) {
    assert.ok(
      m === 'href="mailto:shane@leveragedsystems.com.au?subject=20-minute%20chat"' || m === 'href="mailto:shane@leveragedsystems.com.au"',
      `unexpected mailto: ${m}`,
    );
  }
});

test('no pricing, ABN, LinkedIn, photo or placeholders', () => {
  const body = html.slice(html.indexOf('<body>'));
  assert.doesNotMatch(body, /A\$|\+ ?GST|per month|\/mo\b|\[ABN\]|\bABN\b|linkedin|<img|\[[a-z ]+\]|wording to confirm|OPTIONAL/i);
});

test('favicons and SEO files kept', async () => {
  assert.doesNotMatch(html, /src="data:image/);
  assert.match(html, /rel="icon"[^>]*\/favicon\.png/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /rel="canonical" href="https:\/\/leveragedsystems\.com\.au\/"/);
  await access(new URL('../../sitemap.xml', import.meta.url));
  await access(new URL('../../robots.txt', import.meta.url));
});
