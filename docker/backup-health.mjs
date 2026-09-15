import { readFileSync } from 'node:fs';

try {
  const report = JSON.parse(readFileSync('/var/lib/fcp/backups/last-success.json', 'utf8'));
  const age = Date.now() - Date.parse(report.createdAt);
  if (report.remoteMd5Verified !== true || !Number.isFinite(age) || age < 0 || age > 36 * 60 * 60 * 1000) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
