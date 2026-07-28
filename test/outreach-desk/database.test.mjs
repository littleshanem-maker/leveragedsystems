import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOutreachDatabase } from '../../internal/outreach-desk/lib/database.mjs';
import { createRepository } from '../../internal/outreach-desk/lib/repository.mjs';

async function temporaryDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), 'outreach-desk-test-'));
  const filePath = path.join(directory, 'outreach.sqlite');
  const database = openOutreachDatabase({ filePath });
  return { database, directory, filePath, repository: createRepository(database) };
}

test('creates schema once and preserves records across restart', async () => {
  const { database, filePath, repository } = await temporaryDatabase();
  const prospect = repository.createProspect({
    actor: { type: 'human', name: 'Shane' },
    companyName: 'Example Electrical',
    decisionMaker: 'Alex Smith',
    email: 'alex@example.com',
    phone: '03 9000 1234',
    sourceLinks: ['https://example.com'],
    evidence: 'Publicly lists three active projects.',
    problemHypothesis: 'Variation evidence is fragmented.',
    nextAction: { type: 'research', owner: 'agent', dueAt: '2026-07-29T00:00:00.000Z' },
  });
  database.close();

  const reopened = openOutreachDatabase({ filePath });
  const reopenedRepository = createRepository(reopened);
  assert.equal(reopenedRepository.getProspect(prospect.id).companyName, 'Example Electrical');
  assert.equal(reopenedRepository.getProspect(prospect.id).phone, '03 9000 1234');
  assert.equal(reopenedRepository.listEvents(prospect.id).length, 1);
  reopened.close();
});

test('rejects stale versions and rolls back failed multi-record writes', async () => {
  const { database, repository } = await temporaryDatabase();
  const prospect = repository.createProspect({
    actor: { type: 'agent', name: 'researcher' },
    companyName: 'Northside Plumbing',
    decisionMaker: 'Jamie Lee',
    email: 'jamie@example.com',
    phone: '03 9000 6000',
    sourceLinks: ['https://example.com/northside'],
    evidence: 'Commercial maintenance portfolio.',
    problemHypothesis: 'Site instructions arrive through multiple channels.',
    nextAction: { type: 'review', owner: 'shane', dueAt: '2026-07-29T00:00:00.000Z' },
  });

  const updated = repository.updateProspect(prospect.id, {
    actor: { type: 'human', name: 'Shane' },
    expectedVersion: prospect.version,
    patch: { location: 'Melbourne' },
  });
  assert.equal(updated.version, 2);
  assert.throws(
    () => repository.updateProspect(prospect.id, {
      actor: { type: 'agent', name: 'researcher' },
      expectedVersion: prospect.version,
      patch: { trade: 'Plumbing' },
    }),
    /version conflict/i,
  );

  const beforeEvents = repository.listEvents(prospect.id).length;
  assert.throws(() => repository.transaction(() => {
    repository.appendEvent({
      prospectId: prospect.id,
      kind: 'test.partial',
      actor: { type: 'agent', name: 'researcher' },
      payload: {},
    });
    throw new Error('force rollback');
  }), /force rollback/);
  assert.equal(repository.listEvents(prospect.id).length, beforeEvents);
  database.close();
});

test('handles fifty prospects deterministically and creates private files', async () => {
  const { database, directory, filePath, repository } = await temporaryDatabase();
  for (let index = 50; index >= 1; index -= 1) {
    repository.createProspect({
      actor: { type: 'agent', name: 'researcher' },
      companyName: `Company ${String(index).padStart(2, '0')}`,
      decisionMaker: `Person ${index}`,
      email: `person${index}@example.com`,
      phone: `03 9000 ${String(index).padStart(4, '0')}`,
      sourceLinks: [`https://example.com/${index}`],
      evidence: 'Public evidence.',
      problemHypothesis: 'Commercial control gap.',
      nextAction: { type: 'research', owner: 'agent', dueAt: '2026-07-29T00:00:00.000Z' },
    });
  }
  const companies = repository.listProspects().map((prospect) => prospect.companyName);
  assert.deepEqual(companies.slice(0, 3), ['Company 01', 'Company 02', 'Company 03']);
  assert.equal(companies.length, 50);

  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  database.close();
});
