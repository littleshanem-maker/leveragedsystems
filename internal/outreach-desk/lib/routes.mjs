import { createDomain } from './domain.mjs';
import { exportSnapshot, restoreSnapshot, writeSnapshot } from './backup.mjs';
import { outreachBackupDirectory } from './paths.mjs';
import { buildDailyActivity, buildWeeklyScorecard } from './reporting.mjs';
import path from 'node:path';

const PROSPECT_PATCH_FIELDS = new Set([
  'companyName', 'trade', 'location', 'decisionMaker', 'email', 'contactRoute',
  'sourceLinks', 'evidence', 'problemHypothesis', 'warmConnection', 'status',
]);

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function validateCommandInput(operation, body) {
  if (operation !== 'updateProspect') return;
  const patch = body?.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw badRequest('A prospect patch object is required');
  }
  if (!Object.keys(patch).some((field) => PROSPECT_PATCH_FIELDS.has(field))) {
    throw badRequest('No supported prospect fields supplied');
  }
}

function errorResult(error) {
  const statusCode = error.statusCode
    || (/version conflict/i.test(error.message) ? 409 : /required|unsupported|valid/i.test(error.message) ? 400 : 500);
  return { statusCode, body: { error: statusCode === 500 ? 'Internal server error' : error.message } };
}

export function createRouteHandler({
  domain: suppliedDomain,
  backupDirectory = outreachBackupDirectory(),
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
        const events = repository.listEvents();
        return {
          statusCode: 200,
          body: { data: {
            ...buildWeeklyScorecard(events, { targets: settings.weeklyTargets }),
            today: buildDailyActivity(events),
          } },
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
        validateCommandInput(operation, body);
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
