require('dotenv').config();
require('./apply-gcp-sql-env');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const PRISMA_DIR = path.join(__dirname, '..', 'prisma');

const DOMAIN_DIRS = [
  'shared',
  'organization',
  'subscription',
  'iam',
  'audit',
];

async function runSqlFile(prisma, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8').trim();
  if (!sql || sql === 'SELECT 1;') return;

  if (filePath.endsWith('functions.sql')) {
    const blocks = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) || [];
    for (const block of blocks) {
      await prisma.$executeRawUnsafe(block);
    }
    return;
  }

  if (filePath.endsWith('indexes.sql')) {
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    return;
  }

  // validation files: ALTER TABLE block + optional CREATE TRIGGER
  const alterMatch = sql.match(/ALTER TABLE[\s\S]*?;/);
  if (alterMatch) await prisma.$executeRawUnsafe(alterMatch[0]);

  const triggerMatch = sql.match(/CREATE TRIGGER[\s\S]*?;/);
  if (triggerMatch) await prisma.$executeRawUnsafe(triggerMatch[0]);
}

function collectValidationFiles() {
  const files = [];

  const sharedFunctions = path.join(PRISMA_DIR, 'shared', 'functions.sql');
  if (fs.existsSync(sharedFunctions)) files.push(sharedFunctions);

  for (const domain of DOMAIN_DIRS) {
    const validationDir = path.join(PRISMA_DIR, domain, 'validation');
    if (!fs.existsSync(validationDir)) continue;
    for (const name of fs.readdirSync(validationDir).sort()) {
      if (name.endsWith('.sql')) files.push(path.join(validationDir, name));
    }
  }

  const indexes = path.join(PRISMA_DIR, 'shared', 'indexes.sql');
  if (fs.existsSync(indexes)) files.push(indexes);

  return files;
}

async function main() {
  const prisma = new PrismaClient();
  const files = collectValidationFiles();

  console.log('Running Prisma domain validation SQL after migrate...\n');

  try {
    for (const file of files) {
      const label = path.relative(PRISMA_DIR, file).replace(/\\/g, '/');
      process.stdout.write(`  ${label} ... `);
      await runSqlFile(prisma, file);
      console.log('OK');
    }
    console.log('\nValidation complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
