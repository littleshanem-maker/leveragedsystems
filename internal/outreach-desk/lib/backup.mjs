import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EXPORT_VERSION = 1;

const PROSPECT_STATUSES = new Set([
  'researching', 'qualified', 'ready_to_contact', 'contacted', 'follow_up_due',
  'engaged', 'call_booked', 'qualified_opportunity', 'proposal_sent', 'won',
  'nurture', 'disqualified', 'no_response',
]);
const ACTION_STATES = new Set(['pending', 'deferred', 'completed', 'dismissed', 'cancelled']);
const DRAFT_STATES = new Set(['pending_review', 'approved', 'deferred', 'rejected', 'retired', 'opened', 'sent']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function exportSnapshot(repository) {
  return {
    version: EXPORT_VERSION,
    settings: repository.getSettings(),
    prospects: repository.listProspects(),
    actions: repository.listActions(),
    drafts: repository.listDrafts(),
    events: repository.listEvents(),
  };
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
}

function requireString(value, label, { nullable = false, nonempty = true } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || (nonempty && value.trim() === '')) {
    throw new Error(`${label} must be ${nullable ? 'null or ' : ''}a${nonempty ? ' non-empty' : ''} string`);
  }
}

function requireUuid(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be ${nullable ? 'null or ' : ''}a UUID`);
  }
}

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  const match = typeof value === 'string' ? TIMESTAMP_PATTERN.exec(value) : null;
  if (!match || !validTimestampParts(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be ${nullable ? 'null or ' : ''}a valid timestamp`);
  }
}

function validTimestampParts(value) {
  const [date, timeAndZone] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = timeAndZone.match(/^\d{2}:\d{2}:\d{2}/)[0].split(':').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offset = timeAndZone.match(/([+-])(\d{2}):(\d{2})$/);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59
    && (!offset || (Number(offset[2]) <= 23 && Number(offset[3]) <= 59));
}

function requireVersion(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function requireEnum(value, values, label) {
  if (!values.has(value)) throw new Error(`${label} is unsupported: ${String(value)}`);
}

function validateJsonValue(value, label) {
  const pending = [[value, label]];
  const seen = new Set();
  while (pending.length) {
    const [current, currentLabel] = pending.pop();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error(`${currentLabel} must contain JSON-compatible values`);
      continue;
    }
    if (typeof current !== 'object' || (!Array.isArray(current) && !isRecord(current))) {
      throw new Error(`${currentLabel} must contain JSON-compatible values`);
    }
    if (seen.has(current)) throw new Error(`${currentLabel} must not contain circular references`);
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new Error(`${currentLabel} contains an unsafe key`);
      }
      pending.push([child, `${currentLabel}.${key}`]);
    }
  }
}

function validateProspect(item, index, ids) {
  const label = `Export prospects[${index}]`;
  requireRecord(item, label);
  requireUuid(item.id, `${label}.id`);
  for (const field of ['companyName', 'decisionMaker', 'email', 'evidence', 'problemHypothesis']) {
    requireString(item[field], `${label}.${field}`);
  }
  for (const field of ['trade', 'location', 'contactRoute', 'warmConnection']) {
    requireString(item[field], `${label}.${field}`, { nullable: true });
  }
  if (!Array.isArray(item.sourceLinks) || item.sourceLinks.length === 0) {
    throw new Error(`${label}.sourceLinks must be a non-empty array`);
  }
  for (const [linkIndex, link] of item.sourceLinks.entries()) {
    requireString(link, `${label}.sourceLinks[${linkIndex}]`);
    try {
      const url = new URL(link);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw new Error(`${label}.sourceLinks[${linkIndex}] must be a valid HTTP or HTTPS URL`);
    }
  }
  requireEnum(item.status, PROSPECT_STATUSES, `${label}.status`);
  requireVersion(item.version, `${label}.version`);
  requireTimestamp(item.createdAt, `${label}.createdAt`);
  requireTimestamp(item.updatedAt, `${label}.updatedAt`);
  addUniqueId(ids, item.id, label);
}

function validateAction(item, index, ids) {
  const label = `Export actions[${index}]`;
  requireRecord(item, label);
  requireUuid(item.id, `${label}.id`);
  requireUuid(item.prospectId, `${label}.prospectId`);
  requireString(item.type, `${label}.type`);
  requireString(item.owner, `${label}.owner`);
  requireTimestamp(item.dueAt, `${label}.dueAt`);
  requireEnum(item.state, ACTION_STATES, `${label}.state`);
  requireString(item.outcome, `${label}.outcome`, { nullable: true, nonempty: false });
  requireTimestamp(item.completedAt, `${label}.completedAt`, { nullable: true });
  requireVersion(item.version, `${label}.version`);
  requireTimestamp(item.createdAt, `${label}.createdAt`);
  requireTimestamp(item.updatedAt, `${label}.updatedAt`);
  addUniqueId(ids, item.id, label);
}

function validateDraft(item, index, ids) {
  const label = `Export drafts[${index}]`;
  requireRecord(item, label);
  requireUuid(item.id, `${label}.id`);
  requireUuid(item.prospectId, `${label}.prospectId`);
  requireUuid(item.actionId, `${label}.actionId`, { nullable: true });
  for (const field of ['recipient', 'subject', 'body', 'problemAngle', 'evidenceBasis']) {
    requireString(item[field], `${label}.${field}`);
  }
  requireEnum(item.state, DRAFT_STATES, `${label}.state`);
  for (const field of ['deferUntil', 'openedAt', 'sentAt']) {
    requireTimestamp(item[field], `${label}.${field}`, { nullable: true });
  }
  requireVersion(item.version, `${label}.version`);
  requireTimestamp(item.createdAt, `${label}.createdAt`);
  requireTimestamp(item.updatedAt, `${label}.updatedAt`);
  addUniqueId(ids, item.id, label);
}

function validateEvent(item, index, ids) {
  const label = `Export events[${index}]`;
  requireRecord(item, label);
  requireUuid(item.id, `${label}.id`);
  requireUuid(item.prospectId, `${label}.prospectId`, { nullable: true });
  requireString(item.kind, `${label}.kind`);
  requireRecord(item.actor, `${label}.actor`);
  requireString(item.actor.type, `${label}.actor.type`);
  requireString(item.actor.name, `${label}.actor.name`);
  requireRecord(item.payload, `${label}.payload`);
  validateJsonValue(item.payload, `${label}.payload`);
  requireTimestamp(item.createdAt, `${label}.createdAt`);
  addUniqueId(ids, item.id, label);
}

function addUniqueId(ids, id, label) {
  if (ids.has(id)) throw new Error(`${label}.id duplicates another record ID`);
  ids.add(id);
}

function validateSettings(settings) {
  requireRecord(settings, 'Export settings');
  if (!Number.isInteger(settings.followUpCadenceDays) || settings.followUpCadenceDays <= 0) {
    throw new Error('Export settings.followUpCadenceDays must be a positive integer');
  }
  requireString(settings.timeZone, 'Export settings.timeZone');
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: settings.timeZone });
  } catch {
    throw new Error('Export settings.timeZone must be a valid IANA time zone');
  }
  requireRecord(settings.weeklyTargets, 'Export settings.weeklyTargets');
  for (const key of ['firstApproaches', 'warmActions', 'followUps']) {
    if (!Number.isInteger(settings.weeklyTargets[key]) || settings.weeklyTargets[key] < 0) {
      throw new Error(`Export settings.weeklyTargets.${key} must be a non-negative integer`);
    }
  }
  validateJsonValue(settings, 'Export settings');
}

function validateReferences(snapshot) {
  const prospectIds = new Set(snapshot.prospects.map((item) => item.id));
  const actionsById = new Map(snapshot.actions.map((item) => [item.id, item]));
  const draftIds = new Set(snapshot.drafts.map((item) => item.id));
  for (const [index, action] of snapshot.actions.entries()) {
    if (!prospectIds.has(action.prospectId)) throw new Error(`Export actions[${index}].prospectId has a broken reference`);
  }
  for (const [index, draft] of snapshot.drafts.entries()) {
    if (!prospectIds.has(draft.prospectId)) throw new Error(`Export drafts[${index}].prospectId has a broken reference`);
    if (draft.actionId !== null) {
      const action = actionsById.get(draft.actionId);
      if (!action) throw new Error(`Export drafts[${index}].actionId has a broken reference`);
      if (action.prospectId !== draft.prospectId) throw new Error(`Export drafts[${index}].actionId references another prospect`);
    }
  }
  for (const [index, event] of snapshot.events.entries()) {
    if (event.prospectId !== null && !prospectIds.has(event.prospectId)) {
      throw new Error(`Export events[${index}].prospectId has a broken reference`);
    }
    for (const [key, knownIds] of [['actionId', actionsById], ['draftId', draftIds]]) {
      if (event.payload[key] === undefined || event.payload[key] === null) continue;
      requireUuid(event.payload[key], `Export events[${index}].payload.${key}`);
      if (!knownIds.has(event.payload[key])) {
        throw new Error(`Export events[${index}].payload.${key} has a broken reference`);
      }
    }
  }
}

function validateSnapshot(snapshot) {
  requireRecord(snapshot, 'Export');
  if (snapshot?.version !== EXPORT_VERSION) throw new Error(`Unsupported export version: ${snapshot?.version ?? 'missing'}`);
  for (const key of ['prospects', 'actions', 'drafts', 'events']) {
    if (!Array.isArray(snapshot[key])) throw new Error(`Export ${key} must be an array`);
  }
  validateSettings(snapshot.settings);
  const ids = new Set();
  snapshot.prospects.forEach((item, index) => validateProspect(item, index, ids));
  snapshot.actions.forEach((item, index) => validateAction(item, index, ids));
  snapshot.drafts.forEach((item, index) => validateDraft(item, index, ids));
  snapshot.events.forEach((item, index) => validateEvent(item, index, ids));
  validateReferences(snapshot);
}

export function restoreSnapshot(repository, snapshot) {
  validateSnapshot(snapshot);
  const database = repository.database;
  return repository.transaction(() => {
    database.exec('DELETE FROM events; DELETE FROM drafts; DELETE FROM actions; DELETE FROM prospects; DELETE FROM settings;');

    const insertProspect = database.prepare(`
      INSERT INTO prospects (id, company_name, trade, location, decision_maker, email, contact_route, source_links,
        evidence, problem_hypothesis, warm_connection, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of snapshot.prospects) insertProspect.run(
      item.id, item.companyName, item.trade, item.location, item.decisionMaker, item.email, item.contactRoute,
      JSON.stringify(item.sourceLinks || []), item.evidence, item.problemHypothesis, item.warmConnection,
      item.status, item.version, item.createdAt, item.updatedAt,
    );

    const insertAction = database.prepare(`
      INSERT INTO actions (id, prospect_id, type, owner, due_at, state, outcome, completed_at, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of snapshot.actions) insertAction.run(
      item.id, item.prospectId, item.type, item.owner, item.dueAt, item.state, item.outcome,
      item.completedAt, item.version, item.createdAt, item.updatedAt,
    );

    const insertDraft = database.prepare(`
      INSERT INTO drafts (id, prospect_id, action_id, recipient, subject, body, problem_angle, evidence_basis,
        state, defer_until, opened_at, sent_at, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of snapshot.drafts) insertDraft.run(
      item.id, item.prospectId, item.actionId, item.recipient, item.subject, item.body, item.problemAngle,
      item.evidenceBasis, item.state, item.deferUntil, item.openedAt, item.sentAt,
      item.version, item.createdAt, item.updatedAt,
    );

    const insertEvent = database.prepare(`
      INSERT INTO events (id, prospect_id, kind, actor_type, actor_name, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of snapshot.events) insertEvent.run(
      item.id, item.prospectId, item.kind, item.actor.type, item.actor.name, JSON.stringify(item.payload || {}), item.createdAt,
    );

    const insertSetting = database.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    const timestamp = new Date().toISOString();
    for (const [key, value] of Object.entries(snapshot.settings)) insertSetting.run(key, JSON.stringify(value), timestamp);
    return exportSnapshot(repository);
  });
}

export async function writeSnapshot(filePath, snapshot) {
  validateSnapshot(snapshot);
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
  return filePath;
}
