import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
const retired = ['variation-shield', 'calculator', 'schedule', 'project-kit', 'project-kit-ai'];

test('retired pages and blog redirect to / with temporary (302) redirects', async () => {
  const cfg = JSON.parse(await read('vercel.json'));
  const map = new Map((cfg.redirects ?? []).map((r) => [r.source, r]));
  const expected = retired.flatMap((p) => [`/${p}.html`, `/${p}`]).concat(['/blog', '/blog/', '/blog/:path*']);
  for (const src of expected) {
    const r = map.get(src);
    assert.ok(r, `missing redirect for ${src}`);
    assert.equal(r.destination, '/');
    assert.equal(r.permanent, false);
  }
  assert.ok(!(cfg.rewrites ?? []).some((r) => r.source === '/schedule'), '/schedule rewrite removed');
  assert.ok(![...map.keys()].some((s) => s.startsWith('/api')), 'api routes are not redirected');
});

test('retired page files are kept so the change is reversible', async () => {
  for (const p of retired) await access(new URL(`../../${p}.html`, import.meta.url));
  await access(new URL('../../blog/index.html', import.meta.url));
});

test('sitemap lists only the home page and robots disallows retired paths', async () => {
  const sitemap = await read('sitemap.xml');
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), ['https://leveragedsystems.com.au/']);
  const robots = await read('robots.txt');
  for (const p of ['/variation-shield', '/calculator', '/schedule', '/project-kit', '/blog']) {
    assert.match(robots, new RegExp(`^Disallow: ${p}$`, 'm'));
  }
});

test('home page links to none of the retired pages', async () => {
  const html = await read('index.html');
  for (const p of [...retired, 'blog']) assert.doesNotMatch(html, new RegExp(`href="[^"]*${p}`));
});
