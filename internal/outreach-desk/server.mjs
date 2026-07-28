import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openOutreachDatabase } from './lib/database.mjs';
import { createRepository } from './lib/repository.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function json(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

function normaliseHost(value) {
  return String(value || '').replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
}

function requestOrigin(request) {
  return request.headers.origin || null;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
  }
}

async function serveStatic(response, pathname, publicDirectory) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(publicDirectory, relativePath);
  const publicRoot = `${path.resolve(publicDirectory)}${path.sep}`;
  if (!resolved.startsWith(publicRoot)) return false;
  try {
    const body = await readFile(resolved);
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': CONTENT_TYPES.get(path.extname(resolved)) || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return false;
    throw error;
  }
}

export function createOutreachServer({
  repository,
  host = '127.0.0.1',
  port = 4317,
  publicDirectory = path.join(HERE, 'public'),
  routeHandler = null,
  csrfToken = randomBytes(24).toString('base64url'),
} = {}) {
  const allowedHosts = new Set([host, 'localhost'].map(normaliseHost));

  const handler = async (request, response) => {
    try {
      const receivedHost = normaliseHost(request.headers.host);
      if (!allowedHosts.has(receivedHost)) return json(response, 403, { error: 'Unexpected host' });

      const url = new URL(request.url, `http://${request.headers.host}`);
      const origin = requestOrigin(request);
      if (origin) {
        let originUrl;
        try {
          originUrl = new URL(origin);
        } catch {
          return json(response, 403, { error: 'Unexpected origin' });
        }
        if (originUrl.protocol !== 'http:'
          || !allowedHosts.has(normaliseHost(originUrl.host))
          || originUrl.host !== request.headers.host) {
          return json(response, 403, { error: 'Unexpected origin' });
        }
      }

      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json(response, 200, { ok: true, service: 'outreach-desk' });
      }
      if (url.pathname === '/api/session' && request.method === 'GET') {
        return json(response, 200, { csrfToken });
      }

      if (url.pathname.startsWith('/api/')) {
        if (!routeHandler) return json(response, 404, { error: 'Not found' });
        const mutating = !['GET', 'HEAD'].includes(request.method);
        if (mutating) {
          if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            return json(response, 415, { error: 'Mutations require application/json' });
          }
          if (request.headers['x-outreach-token'] !== csrfToken) {
            return json(response, 403, { error: 'Invalid anti-forgery token' });
          }
        }
        const body = mutating ? await readJson(request) : null;
        const result = await routeHandler({
          body,
          method: request.method,
          pathname: url.pathname,
          query: url.searchParams,
          repository,
          role: request.headers['x-outreach-role'] === 'agent' ? 'agent' : 'human',
        });
        return json(response, result.statusCode || 200, result.body);
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        const served = await serveStatic(response, url.pathname, publicDirectory);
        if (served) return;
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return json(response, statusCode, { error: statusCode === 500 ? 'Internal server error' : error.message });
    }
  };
  const server = createHttpServer(handler);

  return {
    csrfToken,
    handler,
    host,
    port,
    server,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host, port }, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function defaultDataDirectory() {
  return process.env.OUTREACH_DATA_DIR
    ? path.resolve(process.env.OUTREACH_DATA_DIR)
    : path.join(homedir(), 'Library', 'Application Support', 'Leveraged Systems', 'Outreach Desk');
}

export async function startDefaultServer({ routeHandler } = {}) {
  const host = process.env.OUTREACH_HOST || '127.0.0.1';
  const port = Number(process.env.OUTREACH_PORT || 4317);
  if (host !== '127.0.0.1') throw new Error('Outreach Desk only supports the 127.0.0.1 host');
  const database = openOutreachDatabase({ filePath: path.join(defaultDataDirectory(), 'outreach.sqlite') });
  const repository = createRepository(database);
  const service = createOutreachServer({ host, port, repository, routeHandler });
  await service.start();
  return { database, repository, service };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createRouteHandler } = await import('./lib/routes.mjs');
  const { service } = await startDefaultServer({ routeHandler: createRouteHandler() });
  console.log(`Outreach Desk listening on http://${service.host}:${service.port}`);
}
