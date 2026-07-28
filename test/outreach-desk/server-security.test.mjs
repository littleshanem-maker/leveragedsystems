import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createOutreachServer } from '../../internal/outreach-desk/server.mjs';

async function invoke(handler, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = { host: '127.0.0.1:4317', ...headers };
  const response = {
    body: '',
    headers: {},
    statusCode: null,
    writeHead(statusCode, responseHeaders) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
    },
    end(payload = '') {
      this.body += payload.toString();
    },
  };
  await handler(request, response);
  return { ...response, json: () => JSON.parse(response.body) };
}

test('serves health on loopback and rejects hostile hosts, origins, and unsafe mutations', async () => {
  const service = createOutreachServer({
    host: '127.0.0.1',
    port: 4317,
    repository: {},
    routeHandler: async ({ body }) => ({ statusCode: 200, body }),
    csrfToken: 'test-token',
  });

  const health = await invoke(service.handler, { url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().service, 'outreach-desk');

  const hostileHost = await invoke(service.handler, { url: '/api/health', headers: { host: 'evil.example' } });
  assert.equal(hostileHost.statusCode, 403);

  const hostileOrigin = await invoke(service.handler, { url: '/api/session', headers: { origin: 'https://evil.example' } });
  assert.equal(hostileOrigin.statusCode, 403);

  const missingToken = await invoke(service.handler, {
    url: '/api/example',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(missingToken.statusCode, 403);

  const unsafeContent = await invoke(service.handler, {
    url: '/api/example',
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-outreach-token': 'test-token' },
    body: '{}',
  });
  assert.equal(unsafeContent.statusCode, 415);
});
