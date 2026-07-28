import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOutreachDatabase } from '../../internal/outreach-desk/lib/database.mjs';
import { createDomain } from '../../internal/outreach-desk/lib/domain.mjs';
import { createRepository } from '../../internal/outreach-desk/lib/repository.mjs';

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'outreach-email-test-'));
  const database = openOutreachDatabase({ filePath: path.join(directory, 'desk.sqlite') });
  const repository = createRepository(database, { now: () => '2026-07-28T02:00:00.000Z' });
  return { database, domain: createDomain(repository), repository };
}

function prepare(domain, repository) {
  const agent = { role: 'agent', actor: { type: 'agent', name: 'writer' } };
  const prospect = domain.execute('createProspect', {
    companyName: 'Handoff Co', decisionMaker: 'Morgan', email: 'morgan@example.com', phone: '03 9000 5000',
    sourceLinks: ['https://example.com'], evidence: 'Three current projects.',
    problemHypothesis: 'Approval records are fragmented.',
    nextAction: { type: 'first_approach', owner: 'shane', dueAt: '2026-07-28T02:00:00.000Z' },
  }, agent);
  const action = repository.listActions({ prospectId: prospect.id })[0];
  const draft = domain.execute('createDraft', {
    prospectId: prospect.id, actionId: action.id, recipient: prospect.email,
    subject: 'A question about approval records', body: 'Hi Morgan,\n\nI noticed your current project work.',
    problemAngle: 'Approval records are fragmented.', evidenceBasis: 'Three current projects.',
  }, agent);
  return { action, draft, prospect };
}

test('requires Shane approval before handoff and does not count opening as sent', async () => {
  const { database, domain, repository } = await setup();
  const { draft, prospect } = prepare(domain, repository);
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  assert.throws(() => domain.execute('openDraft', { draftId: draft.id, expectedVersion: draft.version }, human), /approved/i);

  const approved = domain.execute('approveDraft', {
    draftId: draft.id, expectedVersion: draft.version,
    edits: { subject: 'Question about your approval records' },
  }, human);
  const opened = domain.execute('openDraft', { draftId: approved.id, expectedVersion: approved.version }, human);
  assert.equal(opened.draft.state, 'opened');
  assert.match(opened.mailtoUri, /^mailto:/);
  assert.equal(repository.listEvents(prospect.id).filter((event) => event.kind === 'email.sent').length, 0);
  assert.equal(repository.listActions({ prospectId: prospect.id }).filter((action) => action.type === 'follow_up').length, 0);
  database.close();
});

test('approval and handoff recheck the prospect before continuing restored drafts', async (t) => {
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };

  await t.test('approval', async () => {
    const { database, domain, repository } = await setup();
    const { draft, prospect } = prepare(domain, repository);
    repository.updateProspect(prospect.id, {
      actor: human.actor,
      expectedVersion: prospect.version,
      patch: { status: 'disqualified' },
    });
    assert.throws(() => domain.execute('approveDraft', {
      draftId: draft.id,
      expectedVersion: draft.version,
    }, human), /suppressed/i);
    assert.equal(repository.getDraft(draft.id).state, 'pending_review');
    database.close();
  });

  await t.test('Apple Mail handoff', async () => {
    const { database, domain, repository } = await setup();
    const { draft, prospect } = prepare(domain, repository);
    const approved = domain.execute('approveDraft', { draftId: draft.id, expectedVersion: draft.version }, human);
    repository.updateProspect(prospect.id, {
      actor: human.actor,
      expectedVersion: prospect.version,
      patch: { status: 'no_response' },
    });
    assert.throws(() => domain.execute('openDraft', {
      draftId: draft.id,
      expectedVersion: approved.version,
    }, human), /suppressed/i);
    assert.equal(repository.getDraft(draft.id).state, 'approved');
    database.close();
  });
});

test('sent confirmation is idempotent and creates one correctly dated follow-up', async () => {
  const { database, domain, repository } = await setup();
  const { action, draft, prospect } = prepare(domain, repository);
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const unrelated = domain.execute('proposeAction', {
    prospectId: prospect.id,
    type: 'first_approach',
    owner: 'shane',
    dueAt: '2026-07-29T02:00:00.000Z',
  }, human);
  const approved = domain.execute('approveDraft', { draftId: draft.id, expectedVersion: draft.version }, human);
  const opened = domain.execute('openDraft', { draftId: approved.id, expectedVersion: approved.version }, human);
  const sent = domain.execute('confirmSent', { draftId: draft.id, expectedVersion: opened.draft.version }, human);
  const repeated = domain.execute('confirmSent', { draftId: draft.id, expectedVersion: sent.version }, human);

  assert.equal(repeated.state, 'sent');
  assert.equal(repository.listEvents(prospect.id).filter((event) => event.kind === 'email.sent').length, 1);
  assert.equal(repository.getAction(action.id).state, 'completed');
  assert.equal(repository.getAction(unrelated.id).state, 'pending');
  const followUps = repository.listActions({ prospectId: prospect.id }).filter((action) => action.type === 'follow_up');
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].dueAt, '2026-07-31T02:00:00.000Z');
  database.close();
});

test('a terminal status recorded between handoff and confirmation blocks sent activity and follow-up recreation', async () => {
  const { database, domain, repository } = await setup();
  const { draft, prospect } = prepare(domain, repository);
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const approved = domain.execute('approveDraft', { draftId: draft.id, expectedVersion: draft.version }, human);
  const opened = domain.execute('openDraft', { draftId: approved.id, expectedVersion: approved.version }, human);
  domain.execute('updateProspect', {
    prospectId: prospect.id,
    expectedVersion: prospect.version,
    patch: { status: 'won' },
  }, human);

  assert.equal(repository.getDraft(draft.id).state, 'retired');
  assert.throws(() => domain.execute('confirmSent', {
    draftId: draft.id,
    expectedVersion: opened.draft.version,
  }, human), /suppressed/i);
  assert.equal(repository.listEvents(prospect.id).filter((event) => event.kind === 'email.sent').length, 0);
  assert.equal(repository.listActions({ prospectId: prospect.id, states: ['pending', 'deferred'] }).length, 0);
  database.close();
});

test('reject and defer never create handoffs or follow-ups', async () => {
  const { database, domain, repository } = await setup();
  const { draft, prospect } = prepare(domain, repository);
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const deferred = domain.execute('deferDraft', {
    draftId: draft.id, expectedVersion: draft.version, deferUntil: '2026-07-30T02:00:00.000Z',
  }, human);
  const rejected = domain.execute('rejectDraft', { draftId: draft.id, expectedVersion: deferred.version }, human);
  assert.equal(rejected.state, 'rejected');
  assert.equal(repository.listEvents(prospect.id).some((event) => event.kind === 'email.sent'), false);
  assert.equal(repository.listActions({ prospectId: prospect.id }).some((action) => action.type === 'follow_up'), false);
  database.close();
});
