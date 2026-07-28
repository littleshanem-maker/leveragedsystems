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
  phone: '03 9000 1000',
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

test('drafts require one active action on the same prospect and promote preparation work transactionally', async (t) => {
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const draftInput = {
    recipient: 'morgan@example.com',
    subject: 'A question about variation records',
    body: 'Hi Morgan, I noticed your live commercial work and had a question.',
    problemAngle: 'Evidence is fragmented.',
    evidenceBasis: 'Four live commercial projects.',
  };

  await t.test('missing action', async () => {
    const { database, domain } = await setup();
    const prospect = domain.execute('createProspect', prospectInput, human);
    assert.throws(() => domain.execute('createDraft', {
      ...draftInput,
      prospectId: prospect.id,
    }, human), /active action is required/i);
    database.close();
  });

  await t.test('action from another prospect', async () => {
    const { database, domain, repository } = await setup();
    const first = domain.execute('createProspect', prospectInput, human);
    const second = domain.execute('createProspect', { ...prospectInput, companyName: 'Other Co' }, human);
    const action = repository.listActions({ prospectId: first.id })[0];
    assert.throws(() => domain.execute('createDraft', {
      ...draftInput,
      prospectId: second.id,
      actionId: action.id,
    }, human), /same prospect/i);
    database.close();
  });

  await t.test('inactive action', async () => {
    const { database, domain, repository } = await setup();
    const prospect = domain.execute('createProspect', prospectInput, human);
    const action = repository.listActions({ prospectId: prospect.id })[0];
    domain.execute('completeAction', { actionId: action.id, expectedVersion: action.version }, human);
    assert.throws(() => domain.execute('createDraft', {
      ...draftInput,
      prospectId: prospect.id,
      actionId: action.id,
    }, human), /must be active/i);
    database.close();
  });

  await t.test('review action promotion', async () => {
    const { database, domain, repository } = await setup();
    const prospect = domain.execute('createProspect', prospectInput, human);
    const action = repository.listActions({ prospectId: prospect.id })[0];
    const draft = domain.execute('createDraft', {
      ...draftInput,
      prospectId: prospect.id,
      actionId: action.id,
    }, human);
    assert.equal(draft.actionId, action.id);
    assert.equal(repository.getAction(action.id).type, 'first_approach');
    database.close();
  });
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

test('terminal statuses cancel active work and retire active drafts', async (t) => {
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  for (const status of ['disqualified', 'no_response', 'won']) {
    await t.test(status, async () => {
      const { database, domain, repository } = await setup();
      const prospect = domain.execute('createProspect', prospectInput, human);
      const action = repository.listActions({ prospectId: prospect.id })[0];
      const draft = domain.execute('createDraft', {
        prospectId: prospect.id,
        actionId: action.id,
        recipient: prospect.email,
        subject: 'A question about variation records',
        body: 'Hi Morgan, I noticed your live commercial work and had a question.',
        problemAngle: 'Evidence is fragmented.',
        evidenceBasis: 'Four live commercial projects.',
      }, human);
      domain.execute('proposeAction', {
        prospectId: prospect.id,
        type: 'follow_up',
        owner: 'shane',
        dueAt: '2026-08-01T00:00:00.000Z',
      }, human);

      domain.execute('updateProspect', {
        prospectId: prospect.id,
        expectedVersion: prospect.version,
        patch: { status },
      }, human);

      assert.deepEqual(
        repository.listActions({ prospectId: prospect.id }).map((item) => item.state),
        ['cancelled', 'cancelled'],
      );
      assert.equal(repository.getDraft(draft.id).state, 'retired');
      assert.throws(() => domain.execute('proposeAction', {
        prospectId: prospect.id,
        type: 'follow_up',
        owner: 'shane',
        dueAt: '2026-08-02T00:00:00.000Z',
      }, human), /suppressed/i);
      database.close();
    });
  }
});

test('a prospect created terminal does not retain its required seed action', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const prospect = domain.execute('createProspect', { ...prospectInput, status: 'won' }, human);
  assert.equal(repository.listActions({ prospectId: prospect.id, states: ['pending', 'deferred'] }).length, 0);
  database.close();
});

test('engagement events replace generic work with one explicit next action and advance status', async (t) => {
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const scenarios = [
    {
      operation: 'recordReply',
      input: { exactLanguage: 'We lose track of approvals.' },
      status: 'engaged',
      eventKind: 'reply.recorded',
    },
    {
      operation: 'recordCall',
      input: { notes: 'Suitability call completed.' },
      status: 'call_booked',
      eventKind: 'call.recorded',
    },
    {
      operation: 'recordOutcome',
      input: { outcomeType: 'confirmed_problem', notes: 'The problem is current and material.' },
      status: 'qualified_opportunity',
      eventKind: 'problem.confirmed',
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.operation, async () => {
      const { database, domain, repository } = await setup();
      const prospect = domain.execute('createProspect', prospectInput, human);
      domain.execute('proposeAction', {
        prospectId: prospect.id,
        type: 'follow_up',
        owner: 'shane',
        dueAt: '2026-08-01T00:00:00.000Z',
      }, human);

      domain.execute(scenario.operation, {
        prospectId: prospect.id,
        ...scenario.input,
        nextAction: { type: 'explicit_next', owner: 'shane', dueAt: '2026-08-02T00:00:00.000Z' },
      }, human);

      assert.equal(repository.getProspect(prospect.id).status, scenario.status);
      assert.deepEqual(
        repository.listActions({ prospectId: prospect.id, states: ['pending', 'deferred'] }).map((action) => action.type),
        ['explicit_next'],
      );
      assert.equal(repository.listEvents(prospect.id).filter((event) => event.kind === scenario.eventKind).length, 1);
      database.close();
    });
  }
});

test('engagement requires an explicit next action without partially recording the event', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const prospect = domain.execute('createProspect', prospectInput, human);

  assert.throws(() => domain.execute('recordCall', {
    prospectId: prospect.id,
    notes: 'Call happened but follow-up was omitted.',
  }, human), /next action/i);

  assert.equal(repository.getProspect(prospect.id).status, prospect.status);
  assert.deepEqual(repository.listActions({ prospectId: prospect.id, states: ['pending'] }).map((action) => action.type), ['review']);
  assert.equal(repository.listEvents(prospect.id).some((event) => event.kind === 'call.recorded'), false);
  database.close();
});

test('records cold call attempts with structured outcomes and next actions', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const agent = { role: 'agent', actor: { type: 'agent', name: 'prospector' } };
  const prospect = domain.execute('createProspect', prospectInput, human);
  assert.throws(() => domain.execute('recordCallAttempt', {
    prospectId: prospect.id,
    outcome: 'connected',
    notes: 'The problem is current.',
    nextAction: { type: 'book_call', owner: 'shane', dueAt: '2026-07-30T00:00:00.000Z' },
  }, agent), /Shane-only/i);

  domain.execute('recordCallAttempt', {
    prospectId: prospect.id,
    outcome: 'connected',
    notes: 'They chase approval evidence across site and office.',
    nextAction: { type: 'book_call', owner: 'shane', dueAt: '2026-07-30T00:00:00.000Z' },
  }, human);

  assert.equal(repository.getProspect(prospect.id).status, 'engaged');
  assert.deepEqual(repository.listActions({ prospectId: prospect.id, states: ['pending'] }).map((action) => action.type), ['book_call']);
  assert.deepEqual(repository.listEvents(prospect.id).findLast((event) => event.kind === 'call.attempted').payload, {
    outcome: 'connected',
    notes: 'They chase approval evidence across site and office.',
  });

  const bookedProspect = domain.execute('createProspect', { ...prospectInput, companyName: 'Booked Co' }, human);
  domain.execute('recordReply', {
    prospectId: bookedProspect.id,
    exactLanguage: 'Yes, this is relevant.',
    nextAction: { type: 'book_call', owner: 'shane', dueAt: '2026-07-30T00:00:00.000Z' },
  }, human);
  domain.execute('recordCallAttempt', {
    prospectId: bookedProspect.id,
    outcome: 'booked',
    notes: 'Suitability call booked.',
    nextAction: { type: 'prepare_call', owner: 'shane', dueAt: '2026-07-31T00:00:00.000Z' },
  }, human);
  assert.equal(repository.getProspect(bookedProspect.id).status, 'call_booked');
  database.close();
});

test('do-not-contact cold call outcome suppresses future outreach without a fake next action', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const prospect = domain.execute('createProspect', prospectInput, human);

  domain.execute('recordCallAttempt', {
    prospectId: prospect.id,
    outcome: 'do_not_contact',
    notes: 'Asked not to receive further contact.',
  }, human);

  assert.equal(repository.getProspect(prospect.id).status, 'disqualified');
  assert.equal(repository.listActions({ prospectId: prospect.id, states: ['pending', 'deferred'] }).length, 0);
  database.close();
});

test('proposal advances the pipeline while sale and cash leave won prospects with no next action', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  const prospect = domain.execute('createProspect', prospectInput, human);

  domain.execute('recordOutcome', {
    prospectId: prospect.id,
    outcomeType: 'proposal',
    notes: 'Proposal sent after the review.',
    nextAction: { type: 'proposal_follow_up', owner: 'shane', dueAt: '2026-08-04T00:00:00.000Z' },
  }, human);
  assert.equal(repository.getProspect(prospect.id).status, 'proposal_sent');

  domain.execute('recordOutcome', {
    prospectId: prospect.id,
    outcomeType: 'sale',
    notes: 'Accepted.',
    nextAction: { type: 'should_not_exist', owner: 'shane', dueAt: '2026-08-05T00:00:00.000Z' },
  }, human);
  assert.equal(repository.getProspect(prospect.id).status, 'won');
  assert.equal(repository.listActions({ prospectId: prospect.id, states: ['pending', 'deferred'] }).length, 0);

  domain.execute('recordOutcome', {
    prospectId: prospect.id,
    outcomeType: 'cash',
    amount: 5000,
    nextAction: { type: 'also_should_not_exist', owner: 'shane', dueAt: '2026-08-06T00:00:00.000Z' },
  }, human);
  assert.equal(repository.getProspect(prospect.id).status, 'won');
  assert.equal(repository.listActions({ prospectId: prospect.id, states: ['pending', 'deferred'] }).length, 0);
  database.close();
});

test('requires complete prospect evidence and preserves the winning concurrent update', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  assert.throws(() => domain.execute('createProspect', { companyName: 'Incomplete' }, human), /required/i);
  assert.throws(() => domain.execute('createProspect', { ...prospectInput, phone: ' ' }, human), /phone number is required/i);
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
    expectedVersion: updated.version,
    patch: { phone: '' },
  }, human), /phone number is required/i);
  assert.throws(() => domain.execute('updateProspect', {
    prospectId: prospect.id,
    expectedVersion: prospect.version,
    patch: { trade: 'Electrical' },
  }, human), /version conflict/i);
  database.close();
});

test('accepts only HTTP source evidence links', async () => {
  const { database, domain, repository } = await setup();
  const human = { role: 'human', actor: { type: 'human', name: 'Shane' } };
  assert.throws(() => domain.execute('createProspect', {
    ...prospectInput,
    sourceLinks: ['javascript:alert(1)'],
  }, human), /HTTP or HTTPS/i);
  assert.equal(repository.listProspects().length, 0);
  database.close();
});
