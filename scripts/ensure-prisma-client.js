/**
 * Regenerates Prisma Client when schema files are newer than the generated client.
 * Prevents TS2353/TS2339 after git pull (source updated, node_modules client stale).
 *
 * Usage: node scripts/ensure-prisma-client.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRISMA_DIR = path.join(ROOT, 'prisma');
const GENERATED = path.join(ROOT, 'node_modules', '.prisma', 'client', 'index.d.ts');

function maxMtime(dir) {
  let max = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'migrations' || entry.name === 'node_modules') continue;
        stack.push(full);
      } else if (entry.name.endsWith('.prisma')) {
        const t = fs.statSync(full).mtimeMs;
        if (t > max) max = t;
      }
    }
  }
  return max;
}

function needsGenerate() {
  if (!fs.existsSync(GENERATED)) return true;
  const schemaTime = maxMtime(PRISMA_DIR);
  const clientTime = fs.statSync(GENERATED).mtimeMs;
  return schemaTime > clientTime;
}

function clientLooksStale() {
  if (!fs.existsSync(GENERATED)) return true;
  const text = fs.readFileSync(GENERATED, 'utf8');
  return (
    !text.includes('CompanyFieldConfiguration') ||
    !text.includes('RoleStatus') ||
    !text.includes('ModuleLifecycleStatus') ||
    !text.includes('endedAt')
  );
}

if (!needsGenerate() && !clientLooksStale()) {
  process.exit(0);
}

console.log('[prisma] Generated client is missing or older than prisma/*.prisma — running prisma generate…');
try {
  execSync('npx prisma generate', { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  console.error('');
  console.error('============================================================');
  console.error('Prisma generate FAILED.');
  console.error('On Windows this is usually EPERM because nest start --watch');
  console.error('is still running. Stop the backend, then run:');
  console.error('  npx prisma generate');
  console.error('  npx prisma migrate deploy');
  console.error('============================================================');
  process.exit(err.status || 1);
}
