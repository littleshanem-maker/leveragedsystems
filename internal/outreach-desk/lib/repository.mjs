import { randomUUID } from 'node:crypto';

const PROSPECT_FIELDS = {
  companyName: 'company_name',
  trade: 'trade',
  location: 'location',
  decisionMaker: 'decision_maker',
  email: 'email',
  contactRoute: 'contact_route',
  sourceLinks: 'source_links',
  evidence: 'evidence',
  problemHypothesis: 'problem_hypothesis',
  warmConnection: 'warm_connection',
  status: 'status',
};

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function prospectFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company_name,
    trade: row.trade,
    location: row.location,
    decisionMaker: row.decision_maker,
    email: row.email,
    contactRoute: row.contact_route,
    sourceLinks: parseJson(row.source_links, []),
    evidence: row.evidence,
    problemHypothesis: row.problem_hypothesis,
    warmConnection: row.warm_connection,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    prospectId: row.prospect_id,
    type: row.type,
    owner: row.owner,
    dueAt: row.due_at,
    state: row.state,
    outcome: row.outcome,
    completedAt: row.completed_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function draftFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    prospectId: row.prospect_id,
    actionId: row.action_id,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    problemAngle: row.problem_angle,
    evidenceBasis: row.evidence_basis,
    state: row.state,
    deferUntil: row.defer_until,
    openedAt: row.opened_at,
    sentAt: row.sent_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventFromRow(row) {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    kind: row.kind,
    actor: { type: row.actor_type, name: row.actor_name },
    payload: parseJson(row.payload, {}),
    createdAt: row.created_at,
  };
}

function ensureActor(actor) {
  if (!actor?.type || !actor?.name) throw new Error('Actor type and name are required');
}

export function createRepository(database, { now = () => new Date().toISOString(), id = randomUUID } = {}) {
  let transactionDepth = 0;

  function transaction(operation) {
    if (transactionDepth > 0) return operation();
    database.exec('BEGIN IMMEDIATE');
    transactionDepth += 1;
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }

  function appendEvent({ prospectId = null, kind, actor, payload = {}, createdAt = now() }) {
    ensureActor(actor);
    const event = { id: id(), prospectId, kind, actor, payload, createdAt };
    database.prepare(`
      INSERT INTO events (id, prospect_id, kind, actor_type, actor_name, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, prospectId, kind, actor.type, actor.name, JSON.stringify(payload), createdAt);
    return event;
  }

  function createAction({ prospectId, type, owner, dueAt, actor, state = 'pending' }) {
    ensureActor(actor);
    if (!prospectId || !type || !owner || !dueAt) throw new Error('Action prospect, type, owner and due date are required');
    const timestamp = now();
    const action = { id: id(), prospectId, type, owner, dueAt, state, version: 1, createdAt: timestamp, updatedAt: timestamp };
    database.prepare(`
      INSERT INTO actions (id, prospect_id, type, owner, due_at, state, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(action.id, prospectId, type, owner, dueAt, state, timestamp, timestamp);
    return action;
  }

  function createProspect(input) {
    ensureActor(input.actor);
    const required = ['companyName', 'decisionMaker', 'email', 'evidence', 'problemHypothesis'];
    for (const field of required) {
      if (!String(input[field] ?? '').trim()) throw new Error(`${field} is required`);
    }
    if (!Array.isArray(input.sourceLinks) || input.sourceLinks.length === 0) throw new Error('At least one source link is required');
    if (!input.nextAction) throw new Error('A next action is required');

    return transaction(() => {
      const timestamp = now();
      const prospectId = id();
      database.prepare(`
        INSERT INTO prospects (
          id, company_name, trade, location, decision_maker, email, contact_route,
          source_links, evidence, problem_hypothesis, warm_connection, status,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        prospectId,
        input.companyName.trim(),
        input.trade?.trim() || null,
        input.location?.trim() || null,
        input.decisionMaker.trim(),
        input.email.trim().toLowerCase(),
        input.contactRoute?.trim() || null,
        JSON.stringify(input.sourceLinks),
        input.evidence.trim(),
        input.problemHypothesis.trim(),
        input.warmConnection?.trim() || null,
        input.status || 'researching',
        timestamp,
        timestamp,
      );
      createAction({ ...input.nextAction, prospectId, actor: input.actor });
      appendEvent({
        prospectId,
        kind: 'prospect.created',
        actor: input.actor,
        payload: { companyName: input.companyName.trim() },
        createdAt: timestamp,
      });
      return prospectFromRow(database.prepare('SELECT * FROM prospects WHERE id = ?').get(prospectId));
    });
  }

  function getProspect(prospectId) {
    return prospectFromRow(database.prepare('SELECT * FROM prospects WHERE id = ?').get(prospectId));
  }

  function listProspects() {
    return database.prepare('SELECT * FROM prospects ORDER BY company_name COLLATE NOCASE, id').all().map(prospectFromRow);
  }

  function updateProspect(prospectId, { actor, expectedVersion, patch }) {
    ensureActor(actor);
    const entries = Object.entries(patch).filter(([key]) => PROSPECT_FIELDS[key]);
    if (entries.length === 0) throw new Error('No supported prospect fields supplied');
    return transaction(() => {
      const existing = getProspect(prospectId);
      if (!existing) throw new Error('Prospect not found');
      if (existing.version !== expectedVersion) throw new Error(`Version conflict: expected ${expectedVersion}, found ${existing.version}`);
      const values = entries.map(([key, value]) => key === 'sourceLinks' ? JSON.stringify(value) : value);
      const assignments = entries.map(([key]) => `${PROSPECT_FIELDS[key]} = ?`).join(', ');
      const timestamp = now();
      const result = database.prepare(`
        UPDATE prospects SET ${assignments}, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(...values, timestamp, prospectId, expectedVersion);
      if (result.changes !== 1) throw new Error('Version conflict while updating prospect');
      appendEvent({ prospectId, kind: 'prospect.updated', actor, payload: { fields: entries.map(([key]) => key) }, createdAt: timestamp });
      return getProspect(prospectId);
    });
  }

  function listActions({ prospectId, states } = {}) {
    const clauses = [];
    const values = [];
    if (prospectId) {
      clauses.push('prospect_id = ?');
      values.push(prospectId);
    }
    if (states?.length) {
      clauses.push(`state IN (${states.map(() => '?').join(', ')})`);
      values.push(...states);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`SELECT * FROM actions ${where} ORDER BY due_at, created_at, id`).all(...values).map(actionFromRow);
  }

  function getAction(actionId) {
    return actionFromRow(database.prepare('SELECT * FROM actions WHERE id = ?').get(actionId));
  }

  function updateAction(actionId, { actor, expectedVersion, patch, eventKind = 'action.updated' }) {
    ensureActor(actor);
    const allowed = new Map([
      ['type', 'type'], ['owner', 'owner'], ['dueAt', 'due_at'], ['state', 'state'],
      ['outcome', 'outcome'], ['completedAt', 'completed_at'],
    ]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (entries.length === 0) throw new Error('No supported action fields supplied');
    return transaction(() => {
      const existing = getAction(actionId);
      if (!existing) throw new Error('Action not found');
      if (existing.version !== expectedVersion) throw new Error(`Version conflict: expected ${expectedVersion}, found ${existing.version}`);
      const timestamp = now();
      const result = database.prepare(`
        UPDATE actions SET ${entries.map(([key]) => `${allowed.get(key)} = ?`).join(', ')},
          version = version + 1, updated_at = ? WHERE id = ? AND version = ?
      `).run(...entries.map(([, value]) => value), timestamp, actionId, expectedVersion);
      if (result.changes !== 1) throw new Error('Version conflict while updating action');
      appendEvent({
        prospectId: existing.prospectId,
        kind: eventKind,
        actor,
        payload: { actionId, fields: entries.map(([key]) => key) },
        createdAt: timestamp,
      });
      return getAction(actionId);
    });
  }

  function cancelActiveActions(prospectId, { actor, reason = 'superseded' } = {}) {
    ensureActor(actor);
    const active = listActions({ prospectId, states: ['pending', 'deferred'] });
    for (const action of active) {
      updateAction(action.id, {
        actor,
        expectedVersion: action.version,
        patch: { state: 'cancelled', outcome: reason, completedAt: now() },
        eventKind: 'action.cancelled',
      });
    }
    return active.length;
  }

  function createDraft({ prospectId, actionId = null, recipient, subject, body, problemAngle, evidenceBasis, actor }) {
    ensureActor(actor);
    const required = { prospectId, recipient, subject, body, problemAngle, evidenceBasis };
    for (const [field, value] of Object.entries(required)) {
      if (!String(value ?? '').trim()) throw new Error(`${field} is required`);
    }
    return transaction(() => {
      const timestamp = now();
      const draftId = id();
      database.prepare(`
        INSERT INTO drafts (
          id, prospect_id, action_id, recipient, subject, body, problem_angle,
          evidence_basis, state, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 1, ?, ?)
      `).run(
        draftId, prospectId, actionId, recipient.trim().toLowerCase(), subject.trim(), body.trim(),
        problemAngle.trim(), evidenceBasis.trim(), timestamp, timestamp,
      );
      appendEvent({
        prospectId,
        kind: 'draft.created',
        actor,
        payload: { draftId, actionId },
        createdAt: timestamp,
      });
      return getDraft(draftId);
    });
  }

  function updateDraft(draftId, { actor, expectedVersion, patch, eventKind = 'draft.updated' }) {
    ensureActor(actor);
    const allowed = new Map([
      ['recipient', 'recipient'], ['subject', 'subject'], ['body', 'body'],
      ['problemAngle', 'problem_angle'], ['evidenceBasis', 'evidence_basis'],
      ['state', 'state'], ['deferUntil', 'defer_until'], ['openedAt', 'opened_at'], ['sentAt', 'sent_at'],
    ]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (entries.length === 0) throw new Error('No supported draft fields supplied');
    return transaction(() => {
      const existing = getDraft(draftId);
      if (!existing) throw new Error('Draft not found');
      if (existing.version !== expectedVersion) throw new Error(`Version conflict: expected ${expectedVersion}, found ${existing.version}`);
      const timestamp = now();
      const result = database.prepare(`
        UPDATE drafts SET ${entries.map(([key]) => `${allowed.get(key)} = ?`).join(', ')},
          version = version + 1, updated_at = ? WHERE id = ? AND version = ?
      `).run(...entries.map(([, value]) => value), timestamp, draftId, expectedVersion);
      if (result.changes !== 1) throw new Error('Version conflict while updating draft');
      appendEvent({
        prospectId: existing.prospectId,
        kind: eventKind,
        actor,
        payload: { draftId, fields: entries.map(([key]) => key) },
        createdAt: timestamp,
      });
      return getDraft(draftId);
    });
  }

  function getDraft(draftId) {
    return draftFromRow(database.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId));
  }

  function listDrafts({ prospectId, states } = {}) {
    const clauses = [];
    const values = [];
    if (prospectId) {
      clauses.push('prospect_id = ?');
      values.push(prospectId);
    }
    if (states?.length) {
      clauses.push(`state IN (${states.map(() => '?').join(', ')})`);
      values.push(...states);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`SELECT * FROM drafts ${where} ORDER BY updated_at DESC, id`).all(...values).map(draftFromRow);
  }

  function listEvents(prospectId = null) {
    const rows = prospectId
      ? database.prepare('SELECT * FROM events WHERE prospect_id = ? ORDER BY created_at, id').all(prospectId)
      : database.prepare('SELECT * FROM events ORDER BY created_at, id').all();
    return rows.map(eventFromRow);
  }

  function getSettings() {
    return Object.fromEntries(database.prepare('SELECT key, value FROM settings ORDER BY key').all().map((row) => [row.key, parseJson(row.value, row.value)]));
  }

  function setSetting(key, value) {
    database.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), now());
  }

  return {
    appendEvent,
    cancelActiveActions,
    createAction,
    createDraft,
    createProspect,
    currentTime: now,
    database,
    getAction,
    getDraft,
    getProspect,
    getSettings,
    listActions,
    listDrafts,
    listEvents,
    listProspects,
    setSetting,
    transaction,
    updateProspect,
    updateAction,
    updateDraft,
  };
}
