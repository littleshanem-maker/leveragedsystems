import { createDomain } from './domain.mjs';
import { exportSnapshot, restoreSnapshot, writeSnapshot } from './backup.mjs';
import { buildWeeklyScorecard } from './reporting.mjs';
import { homedir } from 'node:os';
import path from 'node:path';

function errorResult(error) {
  const statusCode = error.statusCode
    || (/version conflict/i.test(error.message) ? 409 : /required|unsupported|valid/i.test(error.message) ? 400 : 500);
  return { statusCode, body: { error: statusCode === 500 ? 'Internal server error' : error.message } };
}

export function createRouteHandler({
  domain: suppliedDomain,
  backupDirectory = process.env.OUTREACH_BACKUP_DIR
    || path.join(homedir(), 'Library', 'Application Support', 'Leveraged Systems', 'Outreach Desk', 'backups'),
} = {}) {
  return async function route({ method, pathname, body, repository, role = 'human', actorName, query }) {
    const domain = suppliedDomain || createDomain(repository);
    try {
      if (method === 'GET' && pathname === '/api/prospects') {
        return { statusCode: 200, body: { data: repository.listProspects() } };
      }
      if (method === 'GET' && pathname === '/api/today') {
        return { statusCode: 200, body: { data: domain.today() } };
      }
      if (method === 'GET' && pathname === '/api/drafts') {
        return { statusCode: 200, body: { data: repository.listDrafts({ states: ['pending_review', 'deferred', 'approved', 'opened'] }) } };
      }
      if (method === 'GET' && pathname === '/api/scorecard') {
        const settings = repository.getSettings();
        return {
          statusCode: 200,
          body: { data: buildWeeklyScorecard(repository.listEvents(), { targets: settings.weeklyTargets }) },
        };
      }
      if (method === 'GET' && pathname === '/api/export') {
        return { statusCode: 200, body: { data: exportSnapshot(repository) } };
      }
      if (method === 'POST' && pathname === '/api/restore') {
        if (role !== 'human') return { statusCode: 403, body: { error: 'Restore is a Shane-only operation' } };
        const before = exportSnapshot(repository);
        const stamp = new Date().toISOString().replaceAll(':', '-');
        await writeSnapshot(path.join(backupDirectory, `pre-restore-${stamp}.json`), before);
        const restored = restoreSnapshot(repository, body);
        return { statusCode: 200, body: { data: { restored: true, counts: {
          prospects: restored.prospects.length, actions: restored.actions.length,
          drafts: restored.drafts.length, events: restored.events.length,
        } } } };
      }
      if (method === 'GET' && pathname.startsWith('/api/prospects/')) {
        const prospectId = pathname.split('/').at(-1);
        const prospect = repository.getProspect(prospectId);
        if (!prospect) return { statusCode: 404, body: { error: 'Prospect not found' } };
        return {
          statusCode: 200,
          body: {
            data: {
              ...prospect,
              actions: repository.listActions({ prospectId }),
              drafts: repository.listDrafts({ prospectId }),
              events: repository.listEvents(prospectId),
            },
          },
        };
      }
      if (method === 'POST' && pathname.startsWith('/api/commands/')) {
        const operation = pathname.split('/').at(-1);
        const actor = { type: role, name: actorName || (role === 'agent' ? body?.actorName || 'Codex agent' : 'Shane') };
        const data = domain.execute(operation, body, { role, actor });
        return { statusCode: operation.startsWith('create') ? 201 : 200, body: { data } };
      }
      return { statusCode: 404, body: { error: 'Not found' } };
    } catch (error) {
      return errorResult(error);
    }
  };
}
