import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOutreachDatabase } from '../../internal/outreach-desk/lib/database.mjs';
import { createDomain } from '../../internal/outreach-desk/lib/domain.mjs';
import { createRepository } from '../../internal/outreach-desk/lib/repository.mjs';
import { createRouteHandler } from '../../internal/outreach-desk/lib/routes.mjs';

test('browser and agent commands share result shapes while enforcing role capabilities', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'outreach-api-test-'));
  const database = openOutreachDatabase({ filePath: path.join(directory, 'desk.sqlite') });
  const repository = createRepository(database);
  const route = createRouteHandler({ domain: createDomain(repository) });
  const base = {
    companyName: 'Parity Co',
    decisionMaker: 'Taylor Doe',
    email: 'taylor@example.com',
    sourceLinks: ['https://example.com/parity'],
    evidence: 'Public commercial portfolio.',
    problemHypothesis: 'Approvals are delayed.',
    nextAction: { type: 'review', owner: 'shane', dueAt: '2026-07-29T00:00:00.000Z' },
  };

  const agentResult = await route({
    method: 'POST', pathname: '/api/commands/createProspect', body: base,
    repository, role: 'agent', actorName: 'agent-one', query: new URLSearchParams(),
  });
  const humanResult = await route({
    method: 'POST', pathname: '/api/commands/createProspect', body: { ...base, companyName: 'Parity Co Two', email: 'two@example.com' },
    repository, role: 'human', actorName: 'Shane', query: new URLSearchParams(),
  });

  assert.equal(agentResult.statusCode, 201);
  assert.equal(humanResult.statusCode, 201);
  assert.deepEqual(Object.keys(agentResult.body.data), Object.keys(humanResult.body.data));
  assert.equal(repository.listEvents(agentResult.body.data.id)[0].actor.type, 'agent');

  const forbidden = await route({
    method: 'POST', pathname: '/api/commands/recordReply',
    body: { prospectId: agentResult.body.data.id, exactLanguage: 'Yes' },
    repository, role: 'agent', actorName: 'agent-one', query: new URLSearchParams(),
  });
  assert.equal(forbidden.statusCode, 403);

  const list = await route({
    method: 'GET', pathname: '/api/prospects', body: null,
    repository, role: 'human', actorName: 'Shane', query: new URLSearchParams(),
  });
  assert.equal(list.body.data.length, 2);
  database.close();
});

test('invalid mutation patches return 400 without masking unexpected failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'outreach-api-validation-test-'));
  const database = openOutreachDatabase({ filePath: path.join(directory, 'desk.sqlite') });
  const repository = createRepository(database);
  const domain = createDomain(repository);
  const prospect = domain.execute('createProspect', {
    companyName: 'Validation Co',
    decisionMaker: 'Morgan Doe',
    email: 'morgan@example.com',
    sourceLinks: ['https://example.com/validation'],
    evidence: 'Public commercial portfolio.',
    problemHypothesis: 'Approvals are delayed.',
    nextAction: { type: 'review', owner: 'shane', dueAt: '2026-07-29T00:00:00.000Z' },
  }, { role: 'human', actor: { type: 'human', name: 'Shane' } });
  const route = createRouteHandler({ domain });
  const command = (body) => route({
    method: 'POST', pathname: '/api/commands/updateProspect', body,
    repository, role: 'human', actorName: 'Shane', query: new URLSearchParams(),
  });

  const empty = await command({ prospectId: prospect.id, expectedVersion: prospect.version, patch: {} });
  assert.deepEqual(empty, { statusCode: 400, body: { error: 'No supported prospect fields supplied' } });

  const unsupported = await command({
    prospectId: prospect.id,
    expectedVersion: prospect.version,
    patch: { imaginaryField: 'not persisted' },
  });
  assert.deepEqual(unsupported, { statusCode: 400, body: { error: 'No supported prospect fields supplied' } });

  const unexpectedRoute = createRouteHandler({
    domain: { execute: () => { throw new Error('Database unavailable'); } },
  });
  const unexpected = await unexpectedRoute({
    method: 'POST', pathname: '/api/commands/updateProspect',
    body: { prospectId: prospect.id, expectedVersion: prospect.version, patch: { location: 'Melbourne' } },
    repository, role: 'human', actorName: 'Shane', query: new URLSearchParams(),
  });
  assert.deepEqual(unexpected, { statusCode: 500, body: { error: 'Internal server error' } });
  database.close();
});
