import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { exportSnapshot, restoreSnapshot, writeSnapshot } from '../../internal/outreach-desk/lib/backup.mjs';
import { openOutreachDatabase } from '../../internal/outreach-desk/lib/database.mjs';
import { createRepository } from '../../internal/outreach-desk/lib/repository.mjs';
import { createRouteHandler } from '../../internal/outreach-desk/lib/routes.mjs';

async function setup(name) {
  const directory = await mkdtemp(path.join(tmpdir(), `${name}-`));
  const database = openOutreachDatabase({ filePath: path.join(directory, 'desk.sqlite') });
  return { database, directory, repository: createRepository(database) };
}

function seed(repository) {
  return repository.createProspect({
    actor: { type: 'agent', name: 'seed' }, companyName: 'Recovery Co', decisionMaker: 'Alex',
    email: 'alex@example.com', sourceLinks: ['https://example.com'], evidence: 'Evidence',
    problemHypothesis: 'Problem', nextAction: { type: 'review', owner: 'shane', dueAt: '2026-07-30T00:00:00.000Z' },
  });
}

test('exports and restores an equivalent complete operating record', async () => {
  const source = await setup('outreach-export');
  seed(source.repository);
  const snapshot = exportSnapshot(source.repository);
  const target = await setup('outreach-restore');
  restoreSnapshot(target.repository, snapshot);
  assert.deepEqual(exportSnapshot(target.repository), snapshot);
  source.database.close();
  target.database.close();
});

test('invalid snapshots leave live data intact and snapshot files are private', async () => {
  const source = await setup('outreach-invalid');
  seed(source.repository);
  const before = exportSnapshot(source.repository);
  assert.throws(() => restoreSnapshot(source.repository, { version: 999 }), /unsupported export version/i);
  assert.deepEqual(exportSnapshot(source.repository), before);

  const exportPath = path.join(source.directory, 'backups', 'export.json');
  await writeSnapshot(exportPath, before);
  assert.equal((await stat(path.dirname(exportPath))).mode & 0o777, 0o700);
  assert.equal((await stat(exportPath)).mode & 0o777, 0o600);
  source.database.close();
});

test('restore route creates a pre-restore backup and rejects agent callers', async () => {
  const source = await setup('outreach-route-restore');
  seed(source.repository);
  const snapshot = exportSnapshot(source.repository);
  const backupDirectory = path.join(source.directory, 'pre-restore');
  const route = createRouteHandler({ backupDirectory });
  const denied = await route({
    method: 'POST', pathname: '/api/restore', body: snapshot,
    repository: source.repository, role: 'agent', query: new URLSearchParams(),
  });
  assert.equal(denied.statusCode, 403);
  const restored = await route({
    method: 'POST', pathname: '/api/restore', body: snapshot,
    repository: source.repository, role: 'human', query: new URLSearchParams(),
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.data.counts.prospects, 1);
  assert.equal((await stat(backupDirectory)).mode & 0o777, 0o700);
  source.database.close();
});
