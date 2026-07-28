import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { executeAgentOperation } from '../../internal/outreach-desk/agent-cli.mjs';
import { openOutreachDatabase } from '../../internal/outreach-desk/lib/database.mjs';
import { createRouteHandler } from '../../internal/outreach-desk/lib/routes.mjs';
import { createRepository } from '../../internal/outreach-desk/lib/repository.mjs';
import { createOutreachServer } from '../../internal/outreach-desk/server.mjs';

function createTransport(handler) {
  return async function transport(url, options = {}) {
    const parsed = new URL(url);
    const request = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    request.method = options.method || 'GET';
    request.url = `${parsed.pathname}${parsed.search}`;
    request.headers = {
      host: parsed.host,
      ...Object.fromEntries(new Headers(options.headers).entries()),
    };
    let responseBody = '';
    const response = {
      headers: {},
      statusCode: 200,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(payload = '') {
        responseBody += payload.toString();
      },
    };
    await handler(request, response);
    return new Response(responseBody, { status: response.statusCode, headers: response.headers });
  };
}

test('agent CLI reads shared versions and action ids before allowed mutations while Shane-only commands stay blocked', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'outreach-agent-cli-test-'));
  const database = openOutreachDatabase({ filePath: path.join(directory, 'desk.sqlite') });
  const repository = createRepository(database);
  const service = createOutreachServer({
    host: '127.0.0.1',
    port: 0,
    repository,
    routeHandler: createRouteHandler(),
    csrfToken: 'agent-cli-test-token',
  });
  t.after(() => database.close());
  const baseUrl = 'http://127.0.0.1:4317';
  const fetchImpl = createTransport(service.handler);
  const request = (operation, input = {}) => executeAgentOperation({
    operation,
    input,
    baseUrl,
    actorName: 'research-agent',
    fetchImpl,
  });

  const created = await request('createProspect', {
    companyName: 'Readable Co',
    decisionMaker: 'Taylor Doe',
    email: 'taylor@example.com',
    sourceLinks: ['https://example.com/research'],
    evidence: 'Initial public evidence.',
    problemHypothesis: 'Approvals are delayed.',
    nextAction: { type: 'first_approach', owner: 'agent', dueAt: '2026-07-29T00:00:00.000Z' },
  });

  const prospects = await request('listProspects');
  assert.equal(prospects[0].id, created.id);

  const shared = await request('getProspect', { prospectId: created.id });
  assert.equal(shared.version, 1);
  assert.equal(shared.actions.length, 1);

  const updated = await request('updateProspect', {
    prospectId: shared.id,
    expectedVersion: shared.version,
    patch: { evidence: 'Updated sourced evidence.' },
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.evidence, 'Updated sourced evidence.');

  const draft = await request('createDraft', {
    prospectId: shared.id,
    actionId: shared.actions[0].id,
    recipient: shared.email,
    subject: 'A useful idea',
    body: 'Hello Taylor',
    problemAngle: shared.problemHypothesis,
    evidenceBasis: updated.evidence,
  });
  const reread = await request('getProspect', { prospectId: shared.id });
  assert.equal(reread.drafts[0].actionId, shared.actions[0].id);
  assert.ok(reread.events.some((event) => event.kind === 'prospect.updated'));

  await assert.rejects(
    request('approveDraft', { draftId: draft.id, expectedVersion: draft.version }),
    /approveDraft is a Shane-only operation/,
  );
});
