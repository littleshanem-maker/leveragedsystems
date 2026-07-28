import { homedir } from 'node:os';
import path from 'node:path';

export function outreachDataDirectory() {
  return process.env.OUTREACH_DATA_DIR
    ? path.resolve(process.env.OUTREACH_DATA_DIR)
    : path.join(homedir(), 'Library', 'Application Support', 'Leveraged Systems', 'Outreach Desk');
}

export function outreachBackupDirectory() {
  return process.env.OUTREACH_BACKUP_DIR
    ? path.resolve(process.env.OUTREACH_BACKUP_DIR)
    : path.join(outreachDataDirectory(), 'backups');
}
