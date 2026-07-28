#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUEST_TIMEOUT_MS = 10_000;
const READ_OPERATIONS = new Map([
  ['listProspects', () => '/api/prospects'],
  ['getProspect', ({ prospectId } = {}) => {
    if (!prospectId) throw new Error('getProspect requires prospectId');
    return `/api/prospects/${encodeURIComponent(prospectId)}`;
  }],
  ['today', () => '/api/today'],
  ['listDrafts', () => '/api/drafts'],
  ['scorecard', () => '/api/scorecard'],
]);

function usage() {
  console.error('Usage: node agent-cli.mjs <operation> [--json <json> | --file <path>] [--url http://127.0.0.1:4317] [--actor name]');
}

async function readResponse(response, label) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `${label} failed: ${response.status}`);
  return result.data;
}

export async function executeAgentOperation({
  operation,
  input = {},
  baseUrl = 'http://127.0.0.1:4317',
  actorName = 'Codex agent',
  fetchImpl = fetch,
} = {}) {
  if (READ_OPERATIONS.has(operation)) {
    const pathname = READ_OPERATIONS.get(operation)(input);
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      headers: {
        'x-outreach-actor': actorName,
        'x-outreach-role': 'agent',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return readResponse(response, 'Read request');
  }

  const sessionResponse = await fetchImpl(`${baseUrl}/api/session`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!sessionResponse.ok) throw new Error(`Session request failed: ${sessionResponse.status}`);
  const { csrfToken } = await sessionResponse.json();
  const response = await fetchImpl(`${baseUrl}/api/commands/${encodeURIComponent(operation)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-outreach-actor': actorName,
      'x-outreach-role': 'agent',
      'x-outreach-token': csrfToken,
    },
    body: JSON.stringify({ ...input, actorName }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return readResponse(response, 'Command');
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const operation = process.argv[2];
  if (!operation) {
    usage();
    process.exitCode = 2;
    return;
  }
  const raw = option('--json') ?? (option('--file') ? await readFile(option('--file'), 'utf8') : '{}');
  const input = JSON.parse(raw);
  const baseUrl = option('--url') || process.env.OUTREACH_URL || 'http://127.0.0.1:4317';
  const actorName = option('--actor') || process.env.OUTREACH_ACTOR || 'Codex agent';
  const result = await executeAgentOperation({ operation, input, baseUrl, actorName });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
