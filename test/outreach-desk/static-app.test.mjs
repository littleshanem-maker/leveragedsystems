import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../internal/outreach-desk/public');

test('static app provides accessible navigation, primary workflow regions, and responsive assets', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const css = await readFile(path.join(root, 'app.css'), 'utf8');
  const script = await readFile(path.join(root, 'app.js'), 'utf8');

  assert.match(html, /<nav[^>]+aria-label="Primary"/);
  assert.match(html, /id="today-view"/);
  assert.match(html, /id="prospects-view"/);
  assert.match(html, /id="scorecard-view"/);
  assert.match(html, /id="data-view"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(script, /stale|conflict/i);
});
