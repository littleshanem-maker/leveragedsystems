import { spawnSync } from 'node:child_process';

const VERCEL_TIMEOUT_MS = 60_000;
const spawnOptions = { encoding: 'utf8', timeout: VERCEL_TIMEOUT_MS };

const versionResult = spawnSync('vercel', ['--version'], spawnOptions);
if (versionResult.status !== 0) {
  if (versionResult.error?.code === 'ETIMEDOUT') {
    console.error(`Vercel CLI version check exceeded ${VERCEL_TIMEOUT_MS / 1000} seconds.`);
    process.exit(1);
  }
  console.error('Vercel CLI is unavailable. Install version 54.17.2 or newer before running this check.');
  process.exit(1);
}
const match = `${versionResult.stdout} ${versionResult.stderr}`.match(/(\d+)\.(\d+)\.(\d+)/);
const version = match ? match.slice(1).map(Number) : [0, 0, 0];
const supported = version[0] > 54 || (version[0] === 54 && (version[1] > 17 || (version[1] === 17 && version[2] >= 2)));
if (!supported) {
  console.error(`Vercel CLI 54.17.2 or newer is required for a non-deploying manifest check; found ${version.join('.')}.`);
  process.exit(1);
}

const result = spawnSync('vercel', ['deploy', '--dry', '--format=json'], spawnOptions);
if (result.status !== 0) {
  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`Vercel dry-run exceeded ${VERCEL_TIMEOUT_MS / 1000} seconds.`);
    process.exit(1);
  }
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
const manifest = result.stdout;
for (const forbidden of ['internal/', 'test/', 'docs/', '.sqlite']) {
  if (manifest.includes(forbidden)) {
    console.error(`Deployment isolation failed: manifest includes ${forbidden}`);
    process.exit(1);
  }
}
for (const required of ['index.html', 'api/']) {
  if (!manifest.includes(required)) {
    console.error(`Deployment isolation failed: expected public path ${required} is absent`);
    process.exit(1);
  }
}
console.log('Vercel dry-run manifest contains the public site and excludes Outreach Desk. No deployment was created.');
