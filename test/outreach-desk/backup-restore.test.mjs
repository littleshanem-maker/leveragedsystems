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
  repository.setSetting('followUpCadenceDays', 5);
  repository.setSetting('timeZone', 'Australia/Sydney');
  repository.setSetting('weeklyTargets', { firstApproaches: 40, warmActions: 15, followUps: 25 });

  const prospect = repository.createProspect({
    actor: { type: 'agent', name: 'seed' }, companyName: 'Recovery Co', decisionMaker: 'Alex',
    email: 'alex@example.com', phone: '08 7000 1234', sourceLinks: ['https://example.com'], evidence: 'Evidence',
    problemHypothesis: 'Problem', nextAction: { type: 'review', owner: 'shane', dueAt: '2026-07-30T00:00:00.000Z' },
  });
  const updatedProspect = repository.updateProspect(prospect.id, {
    actor: { type: 'human', name: 'Shane' }, expectedVersion: prospect.version,
    patch: { location: 'Sydney', status: 'qualified' },
  });
  const action = repository.listActions({ prospectId: prospect.id })[0];
  repository.updateAction(action.id, {
    actor: { type: 'human', name: 'Shane' }, expectedVersion: action.version,
    patch: { state: 'completed', outcome: 'reviewed', completedAt: '2026-07-29T01:00:00.000Z' },
    eventKind: 'action.completed',
  });
  const draft = repository.createDraft({
    prospectId: prospect.id, actionId: action.id, recipient: 'alex@example.com', subject: 'Recovery review',
    body: 'A complete draft body.', problemAngle: 'Recovery gap', evidenceBasis: 'Public recovery evidence',
    actor: { type: 'agent', name: 'draft-writer' },
  });
  repository.updateDraft(draft.id, {
    actor: { type: 'human', name: 'Shane' }, expectedVersion: draft.version,
    patch: { state: 'approved' }, eventKind: 'draft.approved',
  });
  repository.appendEvent({
    prospectId: prospect.id, kind: 'cash.collected', actor: { type: 'human', name: 'Shane' },
    payload: { notes: 'Deposit received', amount: 1250 }, createdAt: '2026-07-29T02:00:00.000Z',
  });
  return updatedProspect;
}

function clone(value) {
  return structuredClone(value);
}

test('exports and restores an equivalent complete operating record', async () => {
  const source = await setup('outreach-export');
  seed(source.repository);
  const snapshot = exportSnapshot(source.repository);
  assert.equal(snapshot.prospects[0].version, 2);
  assert.equal(snapshot.prospects[0].phone, '08 7000 1234');
  assert.equal(snapshot.actions[0].version, 2);
  assert.equal(snapshot.drafts[0].version, 2);
  assert.equal(snapshot.actions[0].outcome, 'reviewed');
  assert.equal(snapshot.settings.followUpCadenceDays, 5);
  assert.equal(snapshot.events.some((event) => event.kind === 'cash.collected' && event.actor.type === 'human'), true);
  const target = await setup('outreach-restore');
  seed(target.repository);
  restoreSnapshot(target.repository, snapshot);
  assert.deepEqual(exportSnapshot(target.repository), snapshot);
  source.database.close();
  target.database.close();
});

test('retired terminal drafts survive export and restore', async () => {
  const source = await setup('outreach-retired-export');
  const prospect = seed(source.repository);
  source.repository.retireActiveDrafts(prospect.id, {
    actor: { type: 'human', name: 'Shane' },
  });
  const snapshot = exportSnapshot(source.repository);
  assert.equal(snapshot.drafts[0].state, 'retired');

  const target = await setup('outreach-retired-restore');
  restoreSnapshot(target.repository, snapshot);
  assert.equal(target.repository.listDrafts({ prospectId: prospect.id })[0].state, 'retired');
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

test('rejects malformed or malicious complete snapshots before changing live data', async () => {
  const source = await setup('outreach-malformed');
  seed(source.repository);
  const before = exportSnapshot(source.repository);
  const cases = [
    ['missing prospect field', (snapshot) => { delete snapshot.prospects[0].companyName; }],
    ['malformed action record', (snapshot) => { snapshot.actions[0] = []; }],
    ['invalid draft field type', (snapshot) => { snapshot.drafts[0].body = 42; }],
    ['missing event field', (snapshot) => { delete snapshot.events[0].kind; }],
    ['non-UUID record id', (snapshot) => { snapshot.drafts[0].id = 'not-a-uuid'; }],
    ['duplicate record id', (snapshot) => { snapshot.events.push(clone(snapshot.events[0])); }],
    ['unsupported prospect status', (snapshot) => { snapshot.prospects[0].status = 'owned'; }],
    ['unsupported action state', (snapshot) => { snapshot.actions[0].state = 'executing'; }],
    ['unsupported draft state', (snapshot) => { snapshot.drafts[0].state = 'javascript:sent'; }],
    ['non-positive version', (snapshot) => { snapshot.prospects[0].version = 0; }],
    ['invalid timestamp', (snapshot) => { snapshot.actions[0].dueAt = 'tomorrow'; }],
    ['impossible timestamp', (snapshot) => { snapshot.events[0].createdAt = '2026-02-31T01:00:00.000Z'; }],
    ['malicious source URL', (snapshot) => { snapshot.prospects[0].sourceLinks = ['javascript:alert(1)']; }],
    ['invalid actor', (snapshot) => { snapshot.events[0].actor = { type: 'agent' }; }],
    ['invalid event payload', (snapshot) => { snapshot.events[0].payload = ['not', 'an', 'object']; }],
    ['invalid settings', (snapshot) => { snapshot.settings.weeklyTargets.followUps = -1; }],
    ['invalid time zone', (snapshot) => { snapshot.settings.timeZone = 'Mars/Olympus'; }],
  ];

  for (const [name, mutate] of cases) {
    const invalid = clone(before);
    mutate(invalid);
    assert.throws(() => restoreSnapshot(source.repository, invalid), Error, name);
    assert.deepEqual(exportSnapshot(source.repository), before, `${name} changed live data`);
  }
  source.database.close();
});

test('rejects broken snapshot references before changing live data', async () => {
  const source = await setup('outreach-broken-references');
  seed(source.repository);
  const before = exportSnapshot(source.repository);
  const missingId = '00000000-0000-4000-8000-000000000000';
  const cases = [
    ['action prospect', (snapshot) => { snapshot.actions[0].prospectId = missingId; }],
    ['draft prospect', (snapshot) => { snapshot.drafts[0].prospectId = missingId; }],
    ['draft action', (snapshot) => { snapshot.drafts[0].actionId = missingId; }],
    ['event prospect', (snapshot) => { snapshot.events[0].prospectId = missingId; }],
    ['event payload action', (snapshot) => {
      snapshot.events.find((event) => event.payload.actionId).payload.actionId = missingId;
    }],
  ];

  for (const [name, mutate] of cases) {
    const invalid = clone(before);
    mutate(invalid);
    assert.throws(() => restoreSnapshot(source.repository, invalid), /reference/i, name);
    assert.deepEqual(exportSnapshot(source.repository), before, `${name} changed live data`);
  }
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
