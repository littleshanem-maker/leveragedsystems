export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS prospects (
        id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        trade TEXT,
        location TEXT,
        decision_maker TEXT NOT NULL,
        email TEXT NOT NULL,
        contact_route TEXT,
        source_links TEXT NOT NULL DEFAULT '[]',
        evidence TEXT NOT NULL,
        problem_hypothesis TEXT NOT NULL,
        warm_connection TEXT,
        status TEXT NOT NULL DEFAULT 'researching',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        owner TEXT NOT NULL,
        due_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        outcome TEXT,
        completed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        action_id TEXT REFERENCES actions(id) ON DELETE SET NULL,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        problem_angle TEXT NOT NULL,
        evidence_basis TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending_review',
        defer_until TEXT,
        opened_at TEXT,
        sent_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        prospect_id TEXT REFERENCES prospects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_actions_queue ON actions(state, due_at);
      CREATE INDEX IF NOT EXISTS idx_actions_prospect ON actions(prospect_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_drafts_state ON drafts(state, updated_at);
      CREATE INDEX IF NOT EXISTS idx_events_prospect ON events(prospect_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_kind_date ON events(kind, created_at);
    `,
  },
];

export function applyMigrations(database) {
  const currentVersion = database.prepare('PRAGMA user_version').get().user_version;
  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
