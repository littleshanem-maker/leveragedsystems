import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations } from './migrations.mjs';

export const MINIMUM_NODE_VERSION = [24, 15, 0];

export function assertSupportedRuntime(version = process.versions.node) {
  const parts = version.split('.').map(Number);
  const supported = parts[0] > MINIMUM_NODE_VERSION[0]
    || (parts[0] === MINIMUM_NODE_VERSION[0] && parts[1] > MINIMUM_NODE_VERSION[1])
    || (parts[0] === MINIMUM_NODE_VERSION[0]
      && parts[1] === MINIMUM_NODE_VERSION[1]
      && parts[2] >= MINIMUM_NODE_VERSION[2]);
  if (!supported) {
    throw new Error(`Outreach Desk requires Node ${MINIMUM_NODE_VERSION.join('.')} or newer; found ${version}`);
  }
}

export function openOutreachDatabase({ filePath }) {
  assertSupportedRuntime();
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const database = new DatabaseSync(filePath);
  chmodSync(filePath, 0o600);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  applyMigrations(database);
  const timestamp = new Date().toISOString();
  const defaults = {
    followUpCadenceDays: 3,
    timeZone: 'Australia/Melbourne',
    weeklyTargets: { firstApproaches: 50, warmActions: 20, followUps: 30 },
  };
  const insertSetting = database.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
  for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, JSON.stringify(value), timestamp);
  return database;
}
