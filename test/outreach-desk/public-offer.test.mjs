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
