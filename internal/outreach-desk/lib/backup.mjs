import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EXPORT_VERSION = 1;

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

function validateSnapshot(snapshot) {
  if (snapshot?.version !== EXPORT_VERSION) throw new Error(`Unsupported export version: ${snapshot?.version ?? 'missing'}`);
  for (const key of ['prospects', 'actions', 'drafts', 'events']) {
    if (!Array.isArray(snapshot[key])) throw new Error(`Export ${key} must be an array`);
  }
  if (!snapshot.settings || typeof snapshot.settings !== 'object' || Array.isArray(snapshot.settings)) {
    throw new Error('Export settings must be an object');
  }
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
