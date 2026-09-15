import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const project = 'dsholtmeyivyjwiuzedb';
const directory = '/var/lib/fcp/backups';
const statePath = join(directory, 'last-success.json');
const credentialPath = '/run/secrets/worker.env';
const caPath = '/run/secrets/supabase-ca.crt';
const bucket = process.env.BACKUP_BUCKET;
const once = process.argv.includes('--once');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function guard() {
  if (!bucket || !/^fcp-supabase-backups-ball-mtaani-496717$/.test(bucket)) throw Error('BUCKET_GUARD');
  if (!existsSync(credentialPath) || !existsSync(caPath)) throw Error('MISSING_SECRET_MOUNT');
  process.loadEnvFile(credentialPath);
  const url = new URL(process.env.DATABASE_URL);
  if (decodeURIComponent(url.username) !== `postgres.${project}` ||
      !url.hostname.endsWith('.supabase.com') || url.pathname !== '/postgres') throw Error('DATABASE_GUARD');
  return url;
}

function dump(url, path) {
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: caPath,
    PGCONNECT_TIMEOUT: '10'
  };
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', ['--format=custom', '--schema=public', '--no-owner', '--no-acl', '--file', path], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let details = '';
    child.stderr.on('data', (chunk) => { details += chunk.toString().slice(0, 512); });
    child.once('error', () => reject(Error('PG_DUMP_START_FAILED')));
    child.once('close', (code) => code === 0 ? resolve() : reject(Error(`PG_DUMP_FAILED_${code}: ${details.replaceAll(env.PGPASSWORD, '[REDACTED]')}`)));
  });
}

async function token() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error(`METADATA_TOKEN_${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw Error('METADATA_TOKEN_MISSING');
  return data.access_token;
}

async function upload(path, objectName, expectedMd5) {
  const body = createReadStream(path);
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}&ifGenerationMatch=0`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(statSync(path).size)
    },
    body, duplex: 'half', signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw Error(`GCS_UPLOAD_${response.status}`);
  const result = await response.json();
  if (result.md5Hash !== expectedMd5 || Number(result.size) !== statSync(path).size) throw Error('GCS_CHECKSUM_MISMATCH');
  return result.generation;
}

function hash(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    md5: createHash('md5').update(bytes).digest('base64')
  };
}

function prune() {
  const files = readdirSync(directory).filter((name) => /^application-\d{4}-\d{2}-\d{2}T.*\.dump$/.test(name)).sort().reverse();
  for (const name of files.slice(2)) unlinkSync(join(directory, name));
}

async function backup() {
  const url = guard();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const now = new Date();
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const filename = `application-${stamp}.dump`;
  const path = join(directory, filename);
  const temporary = `${path}.partial`;
  await dump(url, temporary);
  renameSync(temporary, path);
  prune();
  if (statSync(path).size > 256 * 1024 * 1024) throw Error('DUMP_EXCEEDS_256_MIB_UPLOAD_LIMIT');
  const checksums = hash(path);
  const object = `${project}/${filename}`;
  const generation = await upload(path, object, checksums.md5);
  const report = {
    createdAt: now.toISOString(), project, scope: 'public schema only',
    bucket, object, generation, bytes: statSync(path).size,
    sha256: checksums.sha256, remoteMd5Verified: true
  };
  writeFileSync(statePath, JSON.stringify(report, null, 2), { mode: 0o600 });
  prune();
  console.log(JSON.stringify({ event: 'backup_uploaded', createdAt: report.createdAt, object, bytes: report.bytes, sha256: report.sha256 }));
}

function nextDailyDelay() {
  const next = new Date();
  next.setUTCHours(3, 0, 0, 0);
  if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - Date.now();
}

function backedUpToday() {
  try {
    const report = JSON.parse(readFileSync(statePath, 'utf8'));
    return report.remoteMd5Verified === true &&
      report.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10);
  } catch { return false; }
}

async function main() {
  guard();
  let immediate = once || !backedUpToday();
  while (true) {
    if (!immediate) await sleep(nextDailyDelay());
    immediate = false;
    try { await backup(); }
    catch (error) {
      console.error(JSON.stringify({ event: 'backup_failed', time: new Date().toISOString(), reason: error.message.replaceAll(process.env.DATABASE_URL || '', '[REDACTED]') }));
      if (once) process.exitCode = 1;
      else { await sleep(30 * 60 * 1000); immediate = true; }
    }
    if (once) break;
  }
}

await main();
