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
