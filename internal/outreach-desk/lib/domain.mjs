const TERMINAL_OUTREACH_STATUSES = new Set(['disqualified', 'no_response']);
const ALLOWED_STATUSES = new Set([
  'researching', 'qualified', 'ready_to_contact', 'contacted', 'follow_up_due',
  'engaged', 'call_booked', 'qualified_opportunity', 'proposal_sent', 'won',
  'nurture', 'disqualified', 'no_response',
]);

const AGENT_OPERATIONS = new Set(['createProspect', 'updateProspect', 'createDraft', 'proposeAction']);
const HUMAN_ONLY_OPERATIONS = new Set([
  'approveDraft', 'rejectDraft', 'deferDraft', 'confirmSent', 'recordReply', 'recordCall',
]);

function forbidden(message) {
  throw Object.assign(new Error(message), { statusCode: 403 });
}

function notFound(message) {
  throw Object.assign(new Error(message), { statusCode: 404 });
}

function validateStatus(status) {
  if (status && !ALLOWED_STATUSES.has(status)) throw Object.assign(new Error(`Unsupported prospect status: ${status}`), { statusCode: 400 });
}

function assertOutreachAllowed(prospect) {
  if (!prospect) notFound('Prospect not found');
  if (TERMINAL_OUTREACH_STATUSES.has(prospect.status)) forbidden(`Outreach is suppressed for ${prospect.status} prospects`);
}

export function createDomain(repository) {
  function execute(operation, input = {}, context = {}) {
    const role = context.role || 'human';
    const actor = context.actor || { type: role, name: role === 'agent' ? 'Codex agent' : 'Shane' };
    if (role === 'agent' && !AGENT_OPERATIONS.has(operation)) {
      forbidden(`${operation} is a Shane-only operation`);
    }

    switch (operation) {
      case 'createProspect':
        validateStatus(input.status);
        return repository.createProspect({ ...input, actor });

      case 'updateProspect': {
        const prospect = repository.getProspect(input.prospectId);
        if (!prospect) notFound('Prospect not found');
        if (role === 'agent') {
          const agentFields = new Set([
            'companyName', 'trade', 'location', 'decisionMaker', 'email', 'contactRoute',
            'sourceLinks', 'evidence', 'problemHypothesis', 'warmConnection',
          ]);
          if (Object.keys(input.patch || {}).some((field) => !agentFields.has(field))) {
            forbidden('Agents may update research fields only');
          }
        }
        validateStatus(input.patch?.status);
        const updated = repository.updateProspect(input.prospectId, {
          actor,
          expectedVersion: input.expectedVersion,
          patch: input.patch,
        });
        if (['disqualified', 'no_response'].includes(updated.status)) {
          repository.cancelActiveActions(updated.id, { actor, reason: updated.status });
        }
        return updated;
      }

      case 'proposeAction': {
        const prospect = repository.getProspect(input.prospectId);
        assertOutreachAllowed(prospect);
        return repository.createAction({ ...input, actor });
      }

      case 'createDraft': {
        const prospect = repository.getProspect(input.prospectId);
        assertOutreachAllowed(prospect);
        if (!/^\S+@\S+\.\S+$/.test(input.recipient || '')) throw Object.assign(new Error('A valid recipient is required'), { statusCode: 400 });
        return repository.createDraft({ ...input, actor });
      }

      case 'recordReply':
        if (!String(input.exactLanguage || '').trim()) throw Object.assign(new Error('Exact reply language is required'), { statusCode: 400 });
        return repository.transaction(() => {
          const prospect = repository.getProspect(input.prospectId);
          if (!prospect) notFound('Prospect not found');
          repository.cancelActiveActions(prospect.id, { actor, reason: 'engaged' });
          const engaged = repository.updateProspect(prospect.id, {
            actor,
            expectedVersion: prospect.version,
            patch: { status: 'engaged' },
          });
          repository.appendEvent({
            prospectId: prospect.id,
            kind: 'reply.recorded',
            actor,
            payload: {
              exactLanguage: input.exactLanguage.trim(),
              qualificationEvidence: input.qualificationEvidence?.trim() || null,
            },
          });
          if (input.nextAction) repository.createAction({ ...input.nextAction, prospectId: prospect.id, actor });
          return engaged;
        });

      case 'recordCall': {
        const prospect = repository.getProspect(input.prospectId);
        if (!prospect) notFound('Prospect not found');
        repository.appendEvent({
          prospectId: prospect.id,
          kind: 'call.recorded',
          actor,
          payload: {
            notes: input.notes || '', objections: input.objections || '',
            recommendation: input.recommendation || '', qualificationEvidence: input.qualificationEvidence || '',
          },
        });
        return prospect;
      }

      case 'completeAction':
      case 'deferAction':
      case 'dismissAction': {
        const action = repository.getAction(input.actionId);
        if (!action) notFound('Action not found');
        const state = operation === 'completeAction' ? 'completed' : operation === 'deferAction' ? 'deferred' : 'dismissed';
        return repository.updateAction(action.id, {
          actor,
          expectedVersion: input.expectedVersion ?? action.version,
          patch: {
            state,
            outcome: input.outcome || null,
            dueAt: input.dueAt || action.dueAt,
            completedAt: state === 'completed' ? new Date().toISOString() : null,
          },
          eventKind: `action.${state}`,
        });
      }

      default:
        if (HUMAN_ONLY_OPERATIONS.has(operation)) {
          throw Object.assign(new Error(`${operation} is not implemented yet`), { statusCode: 501 });
        }
        throw Object.assign(new Error(`Unknown operation: ${operation}`), { statusCode: 404 });
    }
  }

  function today() {
    const actions = repository.listActions({ states: ['pending', 'deferred'] });
    const prospects = new Map(repository.listProspects().map((prospect) => [prospect.id, prospect]));
    return actions.map((action) => ({ ...action, prospect: prospects.get(action.prospectId) || null }));
  }

  return { execute, today };
}
