import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOutreachDatabase } from '../../internal/outreach-desk/lib/database.mjs';
import { createDomain } from '../../internal/outreach-desk/lib/domain.mjs';
import { createRepository } from '../../internal/outreach-desk/lib/repository.mjs';

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'outreach-domain-test-'));
  const database = openOutreachDatabase({ filePath: path.join(directory, 'desk.sqlite') });
  const repository = createRepository(database);
  return { database, domain: createDomain(repository), repository };
}

const prospectInput = {
  companyName: 'Signal Electrical',
  decisionMaker: 'Morgan Chen',
  email: 'morgan@example.com',
  sourceLinks: ['https://example.com/signal'],
  evidence: 'Lists four live commercial projects.',
  problemHypothesis: 'Variation evidence is split between inboxes and site records.',
  nextAction: { type: 'review', owner: 'shane', dueAt: '2026-07-29T00:00:00.000Z' },
};

test('agents can prepare attributed prospects and drafts but cannot perform Shane-only operations', async () => {
  const { database, domain, repository } = await setup();
  const agent = { role: 'agent', actor: { type: 'agent', name: 'prospector' } };
  const prospect = domain.execute('createProspect', prospectInput, agent);
  const draft = domain.execute('createDraft', {
    prospectId: prospect.id,
    actionId: repository.listActions({ prospectId: prospect.id })[0].id,
    recipient: prospect.email,
    subject: 'A question about variation records',
    body: 'Hi Morgan, I noticed your live commercial work and had a question.',
    problemAngle: 'Evidence is fragmented.',
    evidenceBasis: 'Four live commercial projects.',
  }, agent);

  assert.equal(draft.state, 'pending_review');
  assert.equal(repository.listEvents(prospect.id).at(-1).actor.name, 'prospector');
  for (const operation of ['approveDraft', 'confirmSent', 'recordReply', 'recordCall']) {
    assert.throws(() => domain.execute(operation, { prospectId: prospect.id, draftId: draft.id }, agent), /Shane-only/i);
  }
  database.close();
});

test('positive replies stop generic follow-ups and terminal outcomes suppress outreach', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const prospect = domain.execute('createProspect', prospectInput, human);
  domain.execute('proposeAction', {
    prospectId: prospect.id,
    type: 'follow_up',
    owner: 'shane',
    dueAt: '2026-08-01T00:00:00.000Z',
  }, human);
  domain.execute('recordReply', {
    prospectId: prospect.id,
    exactLanguage: 'We lose track of approvals between site and the office.',
    qualificationEvidence: 'Confirmed live problem.',
    nextAction: { type: 'book_call', owner: 'shane', dueAt: '2026-07-30T00:00:00.000Z' },
  }, human);

  assert.equal(repository.getProspect(prospect.id).status, 'engaged');
  const active = repository.listActions({ prospectId: prospect.id, states: ['pending'] });
  assert.deepEqual(active.map((action) => action.type), ['book_call']);

  const current = repository.getProspect(prospect.id);
  domain.execute('updateProspect', {
    prospectId: prospect.id,
    expectedVersion: current.version,
    patch: { status: 'disqualified' },
  }, human);
  assert.throws(() => domain.execute('createDraft', {
    prospectId: prospect.id,
    recipient: prospect.email,
    subject: 'Should fail',
    body: 'Suppressed.',
    problemAngle: 'None',
    evidenceBasis: 'None',
  }, human), /suppressed/i);
  database.close();
});

test('requires complete prospect evidence and preserves the winning concurrent update', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  assert.throws(() => domain.execute('createProspect', { companyName: 'Incomplete' }, human), /required/i);
  assert.equal(repository.listProspects().length, 0);

  const prospect = domain.execute('createProspect', prospectInput, human);
  const updated = domain.execute('updateProspect', {
    prospectId: prospect.id,
    expectedVersion: prospect.version,
    patch: { location: 'Melbourne' },
  }, human);
  assert.equal(updated.location, 'Melbourne');
  assert.throws(() => domain.execute('updateProspect', {
    prospectId: prospect.id,
    expectedVersion: prospect.version,
    patch: { trade: 'Electrical' },
  }, human), /version conflict/i);
  database.close();
});
