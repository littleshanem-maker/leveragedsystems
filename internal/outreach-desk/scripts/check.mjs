import { assertSupportedRuntime } from '../lib/database.mjs';

assertSupportedRuntime();
const baseUrl = process.env.OUTREACH_URL || 'http://127.0.0.1:4317';

try {
  const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.log(`Outreach Desk is healthy at ${baseUrl}`);
} catch (error) {
  console.error(`Outreach Desk health check failed at ${baseUrl}: ${error.message}`);
  process.exitCode = 1;
}
