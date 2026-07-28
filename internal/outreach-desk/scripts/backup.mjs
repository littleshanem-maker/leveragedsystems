import path from 'node:path';

import { exportSnapshot, writeSnapshot } from '../lib/backup.mjs';
import { openOutreachDatabase } from '../lib/database.mjs';
import { outreachDataDirectory } from '../lib/paths.mjs';
import { createRepository } from '../lib/repository.mjs';

const dataDirectory = outreachDataDirectory();
const database = openOutreachDatabase({ filePath: path.join(dataDirectory, 'outreach.sqlite') });
try {
  const repository = createRepository(database);
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const destination = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(dataDirectory, 'backups', `manual-${stamp}.json`);
  await writeSnapshot(destination, exportSnapshot(repository));
  console.log(`Private backup written to ${destination}`);
} finally {
  database.close();
}
