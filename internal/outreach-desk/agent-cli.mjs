#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

function usage() {
  console.error('Usage: node agent-cli.mjs <operation> (--json <json> | --file <path>) [--url http://127.0.0.1:4317] [--actor name]');
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
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  if (!sessionResponse.ok) throw new Error(`Session request failed: ${sessionResponse.status}`);
  const { csrfToken } = await sessionResponse.json();
  const response = await fetch(`${baseUrl}/api/commands/${encodeURIComponent(operation)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-outreach-actor': actorName,
      'x-outreach-role': 'agent',
      'x-outreach-token': csrfToken,
    },
    body: JSON.stringify({ ...input, actorName }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Command failed: ${response.status}`);
  process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
