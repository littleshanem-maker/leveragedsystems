import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('package exposes documented local start, test, health, agent, backup and deployment checks', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const script of ['test', 'outreach:start', 'outreach:test', 'outreach:check', 'outreach:agent', 'outreach:backup', 'outreach:verify-deploy']) {
    assert.equal(typeof packageJson.scripts?.[script], 'string', `${script} script is missing`);
  }
});

test('deployment and git ignores keep the internal system and local data private', async () => {
  const vercelIgnore = await readFile(path.join(root, '.vercelignore'), 'utf8');
  const gitIgnore = await readFile(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['internal/', 'test/', 'docs/']) assert.match(vercelIgnore, new RegExp(`^${entry.replace('/', '\\/')}`, 'm'));
  assert.match(gitIgnore, /\.sqlite/);
  assert.match(gitIgnore, /internal\/outreach-desk\/\.data/);
});

test('LaunchAgent packaging is explicit and preserves data on uninstall', async () => {
  const installer = await readFile(path.join(root, 'internal/outreach-desk/scripts/install-launch-agent.sh'), 'utf8');
  const template = await readFile(path.join(root, 'internal/outreach-desk/launchd/com.leveragedsystems.outreach-desk.plist.template'), 'utf8');
  const readme = await readFile(path.join(root, 'internal/outreach-desk/README.md'), 'utf8');
  assert.match(installer, /install\|uninstall/);
  assert.doesNotMatch(installer, /rm\s+-rf/);
  assert.match(template, /KeepAlive/);
  assert.match(readme, /Apple Mail.*default/i);
  assert.match(readme, /FileVault/i);
  assert.match(readme, /phone.*remote/i);
  assert.match(readme, /never sends/i);
});
