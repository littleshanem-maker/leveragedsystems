const TERMINAL_OUTREACH_STATUSES = new Set(['disqualified', 'no_response', 'won']);
const ACTIVE_ACTION_STATES = new Set(['pending', 'deferred']);
const ALLOWED_STATUSES = new Set([
  'researching', 'qualified', 'ready_to_contact', 'contacted', 'follow_up_due',
  'engaged', 'call_booked', 'qualified_opportunity', 'proposal_sent', 'won',
  'nurture', 'disqualified', 'no_response',
]);

const AGENT_OPERATIONS = new Set(['createProspect', 'updateProspect', 'createDraft', 'proposeAction']);
const HUMAN_ONLY_OPERATIONS = new Set([
  'approveDraft', 'rejectDraft', 'deferDraft', 'openDraft', 'markNotSent', 'confirmSent', 'recordReply', 'recordCall', 'recordCallAttempt', 'recordOutcome',
]);

const CALL_ATTEMPT_OUTCOMES = new Map([
  ['no_answer', { status: 'contacted' }],
  ['voicemail', { status: 'contacted' }],
  ['gatekeeper', { status: 'contacted' }],
  ['callback_requested', { status: 'follow_up_due' }],
  ['connected', { status: 'engaged' }],
  ['booked', { status: 'call_booked' }],
  ['not_interested', { status: 'nurture' }],
  ['do_not_contact', { status: 'disqualified', terminal: true }],
]);

import { buildMailtoUri } from './email-handoff.mjs';

function forbidden(message) {
  throw Object.assign(new Error(message), { statusCode: 403 });
}

function notFound(message) {
  throw Object.assign(new Error(message), { statusCode: 404 });
}

function validateStatus(status) {
  if (status && !ALLOWED_STATUSES.has(status)) throw Object.assign(new Error(`Unsupported prospect status: ${status}`), { statusCode: 400 });
}

function validateSourceLinks(sourceLinks) {
  if (!Array.isArray(sourceLinks) || sourceLinks.length === 0) {
    throw Object.assign(new Error('At least one source link is required'), { statusCode: 400 });
  }
  for (const value of sourceLinks) {
    try {
      const url = new URL(String(value));
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw Object.assign(new Error('Source links must be valid HTTP or HTTPS URLs'), { statusCode: 400 });
    }
  }
}

function requirePhone(phone) {
  if (!String(phone ?? '').trim()) {
    throw Object.assign(new Error('A lead or business phone number is required'), { statusCode: 400 });
  }
}

function assertOutreachAllowed(prospect) {
  if (!prospect) notFound('Prospect not found');
  if (TERMINAL_OUTREACH_STATUSES.has(prospect.status)) forbidden(`Outreach is suppressed for ${prospect.status} prospects`);
}

function requireNextAction(nextAction) {
  if (!nextAction) throw Object.assign(new Error('An explicit next action is required'), { statusCode: 400 });
  return nextAction;
}

export function createDomain(repository) {
  function retireTerminalWork(prospect, actor) {
    if (!TERMINAL_OUTREACH_STATUSES.has(prospect.status)) return;
    repository.cancelActiveActions(prospect.id, { actor, reason: prospect.status });
    repository.retireActiveDrafts(prospect.id, { actor });
  }

  function updateProspectStatus(prospect, status, actor) {
    const updated = repository.updateProspect(prospect.id, {
      actor,
      expectedVersion: prospect.version,
      patch: { status },
    });
    retireTerminalWork(updated, actor);
    return updated;
  }

  function recordEngagement({ prospectId, status, eventKind, payload, nextAction, actor }) {
    requireNextAction(nextAction);
    return repository.transaction(() => {
      const prospect = repository.getProspect(prospectId);
      if (!prospect) notFound('Prospect not found');
      repository.cancelActiveActions(prospect.id, { actor, reason: 'engaged' });
      const updated = updateProspectStatus(prospect, status, actor);
      repository.appendEvent({ prospectId: prospect.id, kind: eventKind, actor, payload });
      repository.createAction({ ...nextAction, prospectId: prospect.id, actor, state: 'pending' });
      return updated;
    });
  }

  function execute(operation, input = {}, context = {}) {
    const role = context.role || 'human';
    const actor = context.actor || { type: role, name: role === 'agent' ? 'Codex agent' : 'Shane' };
    if (role === 'agent' && !AGENT_OPERATIONS.has(operation)) {
      forbidden(`${operation} is a Shane-only operation`);
    }

    switch (operation) {
      case 'createProspect':
        validateStatus(input.status);
        validateSourceLinks(input.sourceLinks);
        requirePhone(input.phone);
        return repository.transaction(() => {
          const created = repository.createProspect({ ...input, actor });
          retireTerminalWork(created, actor);
          return created;
        });

      case 'updateProspect': {
        const prospect = repository.getProspect(input.prospectId);
        if (!prospect) notFound('Prospect not found');
        if (role === 'agent') {
          const agentFields = new Set([
            'companyName', 'trade', 'location', 'decisionMaker', 'email', 'contactRoute',
            'phone', 'sourceLinks', 'evidence', 'problemHypothesis', 'warmConnection',
          ]);
          if (Object.keys(input.patch || {}).some((field) => !agentFields.has(field))) {
            forbidden('Agents may update research fields only');
          }
        }
        validateStatus(input.patch?.status);
        if (input.patch?.sourceLinks !== undefined) validateSourceLinks(input.patch.sourceLinks);
        if (input.patch?.phone !== undefined) requirePhone(input.patch.phone);
        return repository.transaction(() => {
          const updated = repository.updateProspect(input.prospectId, {
            actor,
            expectedVersion: input.expectedVersion,
            patch: input.patch,
          });
          retireTerminalWork(updated, actor);
          return updated;
        });
      }

      case 'proposeAction': {
        const prospect = repository.getProspect(input.prospectId);
        assertOutreachAllowed(prospect);
        return repository.createAction({ ...input, actor });
      }

      case 'createDraft': {
        if (!/^\S+@\S+\.\S+$/.test(input.recipient || '')) throw Object.assign(new Error('A valid recipient is required'), { statusCode: 400 });
        return repository.transaction(() => {
          const prospect = repository.getProspect(input.prospectId);
          assertOutreachAllowed(prospect);
          if (!input.actionId) throw Object.assign(new Error('An active action is required for every draft'), { statusCode: 400 });
          let action = repository.getAction(input.actionId);
          if (!action) notFound('Draft action not found');
          if (action.prospectId !== prospect.id) {
            throw Object.assign(new Error('Draft action must belong to the same prospect'), { statusCode: 400 });
          }
          if (!ACTIVE_ACTION_STATES.has(action.state)) {
            throw Object.assign(new Error('Draft action must be active'), { statusCode: 400 });
          }
          if (['review', 'research'].includes(action.type)) {
            action = repository.updateAction(action.id, {
              actor,
              expectedVersion: action.version,
              patch: { type: 'first_approach' },
              eventKind: 'action.promoted_to_first_approach',
            });
          }
          return repository.createDraft({ ...input, actionId: action.id, actor });
        });
      }

      case 'approveDraft': {
        return repository.transaction(() => {
          const draft = repository.getDraft(input.draftId);
          if (!draft) notFound('Draft not found');
          assertOutreachAllowed(repository.getProspect(draft.prospectId));
          if (['rejected', 'retired', 'sent'].includes(draft.state)) forbidden(`A ${draft.state} draft cannot be approved`);
          const edits = input.edits || {};
          const recipient = edits.recipient ?? draft.recipient;
          const subject = edits.subject ?? draft.subject;
          const body = edits.body ?? draft.body;
          buildMailtoUri({ recipient, subject, body });
          return repository.updateDraft(draft.id, {
            actor,
            expectedVersion: input.expectedVersion,
            patch: { ...edits, state: 'approved', deferUntil: null },
            eventKind: 'draft.approved',
          });
        });
      }

      case 'deferDraft': {
        const draft = repository.getDraft(input.draftId);
        if (!draft) notFound('Draft not found');
        if (['rejected', 'sent'].includes(draft.state)) forbidden(`A ${draft.state} draft cannot be deferred`);
        if (!input.deferUntil) throw Object.assign(new Error('A defer date is required'), { statusCode: 400 });
        return repository.updateDraft(draft.id, {
          actor,
          expectedVersion: input.expectedVersion,
          patch: { state: 'deferred', deferUntil: input.deferUntil },
          eventKind: 'draft.deferred',
        });
      }

      case 'rejectDraft': {
        const draft = repository.getDraft(input.draftId);
        if (!draft) notFound('Draft not found');
        if (draft.state === 'sent') forbidden('A sent draft cannot be rejected');
        if (draft.state === 'rejected') return draft;
        return repository.updateDraft(draft.id, {
          actor,
          expectedVersion: input.expectedVersion,
          patch: { state: 'rejected' },
          eventKind: 'draft.rejected',
        });
      }

      case 'openDraft': {
        return repository.transaction(() => {
          const draft = repository.getDraft(input.draftId);
          if (!draft) notFound('Draft not found');
          assertOutreachAllowed(repository.getProspect(draft.prospectId));
          if (draft.state !== 'approved') forbidden('A draft must be approved before Apple Mail handoff');
          const mailtoUri = buildMailtoUri(draft);
          const opened = repository.updateDraft(draft.id, {
            actor,
            expectedVersion: input.expectedVersion,
            patch: { state: 'opened', openedAt: repository.currentTime() },
            eventKind: 'draft.opened',
          });
          return { draft: opened, mailtoUri };
        });
      }

      case 'markNotSent': {
        const draft = repository.getDraft(input.draftId);
        if (!draft) notFound('Draft not found');
        if (draft.state !== 'opened') forbidden('Only an opened draft can be marked not sent');
        return repository.updateDraft(draft.id, {
          actor,
          expectedVersion: input.expectedVersion,
          patch: { state: 'approved' },
          eventKind: 'draft.not_sent',
        });
      }

      case 'confirmSent': {
        return repository.transaction(() => {
          const draft = repository.getDraft(input.draftId);
          if (!draft) notFound('Draft not found');
          assertOutreachAllowed(repository.getProspect(draft.prospectId));
          if (draft.state === 'sent') return draft;
          if (draft.state !== 'opened') forbidden('Only an opened Apple Mail draft can be confirmed sent');
          const sentAt = repository.currentTime();
          const sent = repository.updateDraft(draft.id, {
            actor,
            expectedVersion: input.expectedVersion,
            patch: { state: 'sent', sentAt },
            eventKind: 'draft.sent_confirmed',
          });
          const action = repository.getAction(draft.actionId);
          if (!action) notFound('Draft-linked action not found');
          if (action.prospectId !== draft.prospectId) forbidden('Draft-linked action belongs to another prospect');
          if (ACTIVE_ACTION_STATES.has(action.state)) {
            repository.updateAction(action.id, {
              actor,
              expectedVersion: action.version,
              patch: { state: 'completed', outcome: 'sent', completedAt: sentAt },
              eventKind: 'action.completed',
            });
          }
          repository.appendEvent({
            prospectId: draft.prospectId,
            kind: 'email.sent',
            actor,
            payload: { draftId: draft.id, actionId: action.id, actionType: action.type },
            createdAt: sentAt,
          });
          const prospect = repository.getProspect(draft.prospectId);
          if (prospect && !['engaged', 'won'].includes(prospect.status)) {
            repository.updateProspect(prospect.id, {
              actor,
              expectedVersion: prospect.version,
              patch: { status: 'contacted' },
            });
          }
          const cadenceDays = Number(repository.getSettings().followUpCadenceDays || 3);
          const dueAt = new Date(new Date(sentAt).getTime() + cadenceDays * 86_400_000).toISOString();
          repository.createAction({ prospectId: draft.prospectId, type: 'follow_up', owner: 'shane', dueAt, actor });
          return sent;
        });
      }

      case 'recordReply':
        if (!String(input.exactLanguage || '').trim()) throw Object.assign(new Error('Exact reply language is required'), { statusCode: 400 });
        return recordEngagement({
          prospectId: input.prospectId,
          status: 'engaged',
          eventKind: 'reply.recorded',
          payload: {
            exactLanguage: input.exactLanguage.trim(),
            qualificationEvidence: input.qualificationEvidence?.trim() || null,
          },
          nextAction: input.nextAction,
          actor,
        });

      case 'recordCall':
        return recordEngagement({
          prospectId: input.prospectId,
          status: 'call_booked',
          eventKind: 'call.recorded',
          payload: {
            notes: input.notes || '', objections: input.objections || '',
            recommendation: input.recommendation || '', qualificationEvidence: input.qualificationEvidence || '',
          },
          nextAction: input.nextAction,
          actor,
        });

      case 'recordCallAttempt': {
        const outcome = CALL_ATTEMPT_OUTCOMES.get(input.outcome);
        if (!outcome) throw Object.assign(new Error('Unsupported cold call outcome'), { statusCode: 400 });
        return repository.transaction(() => {
          const prospect = repository.getProspect(input.prospectId);
          assertOutreachAllowed(prospect);
          if (!outcome.terminal) requireNextAction(input.nextAction);
          repository.cancelActiveActions(prospect.id, { actor, reason: `call_attempt:${input.outcome}` });
          const existingPipelineStatus = ['qualified_opportunity', 'proposal_sent', 'won'].includes(prospect.status)
            || (['engaged', 'call_booked'].includes(prospect.status) && input.outcome !== 'booked');
          const updated = existingPipelineStatus ? prospect : updateProspectStatus(prospect, outcome.status, actor);
          repository.appendEvent({
            prospectId: prospect.id,
            kind: 'call.attempted',
            actor,
            payload: { outcome: input.outcome, notes: String(input.notes || '').trim() },
          });
          if (input.nextAction) repository.createAction({ ...input.nextAction, prospectId: prospect.id, actor });
          return updated;
        });
      }

      case 'recordOutcome': {
        const kinds = new Map([
          ['confirmed_problem', 'problem.confirmed'],
          ['recommendation', 'recommendation.made'],
          ['proposal', 'proposal.sent'],
          ['sale', 'sale.won'],
          ['cash', 'cash.collected'],
        ]);
        const kind = kinds.get(input.outcomeType);
        if (!kind) throw Object.assign(new Error('Unsupported outcome type'), { statusCode: 400 });
        if (input.outcomeType === 'confirmed_problem') {
          return recordEngagement({
            prospectId: input.prospectId,
            status: 'qualified_opportunity',
            eventKind: kind,
            payload: { notes: input.notes || '' },
            nextAction: input.nextAction,
            actor,
          });
        }
        return repository.transaction(() => {
          const prospect = repository.getProspect(input.prospectId);
          if (!prospect) notFound('Prospect not found');
          let updated = prospect;
          if (input.outcomeType === 'proposal') updated = updateProspectStatus(prospect, 'proposal_sent', actor);
          if (['sale', 'cash'].includes(input.outcomeType)) updated = updateProspectStatus(prospect, 'won', actor);
          repository.appendEvent({
            prospectId: prospect.id,
            kind,
            actor,
            payload: { notes: input.notes || '', amount: input.outcomeType === 'cash' ? Number(input.amount || 0) : undefined },
          });
          if (input.nextAction && !['sale', 'cash'].includes(input.outcomeType)) {
            repository.createAction({ ...input.nextAction, prospectId: prospect.id, actor });
          }
          return updated;
        });
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
