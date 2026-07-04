/**
 * Restructures prisma/ and src/ to match target ERP folder layout.
 * Run: node scripts/restructure-project-layout.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRISMA = path.join(ROOT, 'prisma');
const LEGACY_IAM = path.join(PRISMA, 'iam');
const SRC = path.join(ROOT, 'src');

const PRISMA_DOMAINS = {
  shared: {
    files: {
      'enums.prisma': '_enums.prisma',
      'currencies.prisma': '001-currencies',
      'countries.prisma': null,
      'functions.sql': '000_validation_functions.sql',
      'indexes.sql': '035_indexes.sql',
    },
  },
  organization: {
    tables: [
      '003-companies',
      '009-company_security_policies',
      '010-branches',
      '011-departments',
      '012-designations',
      '013-warehouses',
    ],
  },
  subscription: {
    tables: [
      '004-subscription_plans',
      '005-modules',
      '006-plan_modules',
      '007-company_subscriptions',
      '008-company_modules',
    ],
  },
  iam: {
    tables: [
      '002-super_admins',
      '014-roles',
      '015-permissions',
      '016-role_permissions',
      '017-users',
      '018-user_authentication',
      '019-user_mfa',
      '020-user_companies',
      '021-user_roles',
      '022-user_module_access',
      '023-user_preferences',
      '024-user_devices',
      '025-user_sessions',
      '026-user_login_history',
      '027-user_password_history',
      '028-user_api_keys',
      '029-user_notifications',
      '030-user_signatures',
      '031-user_attachments',
      '032-user_delegations',
      '033-user_consents',
    ],
  },
  audit: {
    tables: ['034-user_audit'],
  },
};

const EMPTY_PRISMA_DOMAINS = [
  'hrms',
  'crm',
  'sales',
  'purchase',
  'inventory',
  'manufacturing',
  'accounting',
  'payroll',
  'assets',
  'projects',
  'helpdesk',
  'reports',
];

const COUNTRIES_STUB = `// Shared | countries | placeholder for future master data

model Country {
  countryId   BigInt   @id @default(autoincrement()) @map("country_id")
  code        String   @unique @db.VarChar(3)
  name        String   @db.VarChar(100)
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime? @map("updated_at")

  @@map("countries")
}
`;

const SRC_MODULE_MOVES = [
  ['modules/auth', 'modules/iam/authentication'],
  ['modules/users', 'modules/iam/users'],
  ['modules/roles', 'modules/iam/roles'],
  ['modules/organizations', 'modules/organization/companies'],
  ['modules/customers', 'modules/crm/customers'],
  ['modules/vendors', 'modules/purchase/vendors'],
  ['modules/products', 'modules/inventory/items'],
  ['modules/inventory', 'modules/_tmp_inventory_stock'],
  ['modules/_tmp_inventory_stock', 'modules/inventory/stock'],
  ['modules/bom', 'modules/manufacturing/bom'],
  ['modules/production-orders', 'modules/manufacturing/production-orders'],
  ['modules/quality-control', 'modules/manufacturing/quality-control'],
  ['modules/work-orders', 'modules/manufacturing/work-orders'],
  ['modules/maintenance', 'modules/assets/maintenance'],
  ['modules/accounting', 'modules/_tmp_accounting'],
  ['modules/_tmp_accounting', 'modules/accounting/chart-of-accounts'],
  ['modules/payroll', 'modules/hrms/payroll'],
  ['modules/purchases', 'modules/purchase/purchase-orders'],
  ['modules/sales', 'modules/_tmp_sales'],
  ['modules/_tmp_sales', 'modules/sales/sales-orders'],
  ['modules/reporting', 'modules/reports/dashboards'],
];

const SRC_PLACEHOLDER_DIRS = [
  'modules/iam/permissions',
  'modules/iam/sessions',
  'modules/iam/devices',
  'modules/iam/audit',
  'modules/organization/branches',
  'modules/organization/departments',
  'modules/organization/designations',
  'modules/organization/locations',
  'modules/subscription/plans',
  'modules/subscription/company-subscriptions',
  'modules/subscription/invoices',
  'modules/subscription/payments',
  'modules/subscription/renewals',
  'modules/hrms/employees',
  'modules/hrms/attendance',
  'modules/hrms/leave',
  'modules/hrms/shifts',
  'modules/hrms/recruitment',
  'modules/crm/leads',
  'modules/crm/opportunities',
  'modules/crm/contacts',
  'modules/sales/quotations',
  'modules/sales/deliveries',
  'modules/sales/invoices',
  'modules/purchase/rfq',
  'modules/purchase/goods-receipt',
  'modules/inventory/categories',
  'modules/inventory/warehouses',
  'modules/inventory/transfers',
  'modules/inventory/adjustments',
  'modules/manufacturing/work-centers',
  'modules/manufacturing/routing',
  'modules/accounting/journals',
  'modules/accounting/ledger',
  'modules/accounting/tax',
  'modules/accounting/receivables',
  'modules/accounting/payables',
  'modules/accounting/financial-statements',
  'modules/assets/asset-master',
  'modules/assets/depreciation',
  'modules/projects/project-master',
  'modules/projects/tasks',
  'modules/projects/timesheets',
  'modules/projects/billing',
  'modules/helpdesk/tickets',
  'modules/helpdesk/sla',
  'modules/helpdesk/knowledge-base',
  'modules/reports/exports',
  'modules/reports/analytics',
];

const INFRA_PLACEHOLDER_DIRS = [
  'infrastructure/cache',
  'infrastructure/email',
  'infrastructure/logger',
  'infrastructure/notifications',
];

const DOCS_DIRS = [
  'docs/architecture',
  'docs/er-diagrams',
  'docs/api-specs',
  'docs/workflows',
];

const TEST_DIRS = ['test/unit', 'test/integration', 'test/e2e'];

const JOB_FILES = [
  'jobs/subscription-renewal.job.ts',
  'jobs/payroll.job.ts',
  'jobs/notification.job.ts',
  'jobs/report-generation.job.ts',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeGitkeep(dir) {
  ensureDir(dir);
  const file = path.join(dir, '.gitkeep');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
}

function tableFileName(folder) {
  return folder.replace(/^\d{3}-/, '').replace(/_/g, '-') + '.prisma';
}

function readModelBody(folder) {
  const schemaPath = path.join(LEGACY_IAM, folder, 'schema.prisma');
  if (!fs.existsSync(schemaPath)) return null;
  return fs
    .readFileSync(schemaPath, 'utf8')
    .replace(/^\/\/.*\n\n?/gm, '')
    .trim();
}

function readValidation(folder) {
  const valPath = path.join(LEGACY_IAM, folder, 'validation.sql');
  if (!fs.existsSync(valPath)) return null;
  return fs.readFileSync(valPath, 'utf8');
}

function movePrismaDomain(domain, tables) {
  const domainDir = path.join(PRISMA, domain);
  const validationDir = path.join(domainDir, 'validation');
  ensureDir(validationDir);

  for (const folder of tables) {
    const body = readModelBody(folder);
    if (!body) {
      console.warn(`  skip missing model: ${folder}`);
      continue;
    }
    const fileName = tableFileName(folder);
    const table = folder.replace(/^\d{3}-/, '');
    fs.writeFileSync(
      path.join(domainDir, fileName),
      `// ${domain} | ${table}\n\n${body}\n`,
      'utf8',
    );

    const validation = readValidation(folder);
    if (validation) {
      fs.writeFileSync(
        path.join(validationDir, `${table}.validation.sql`),
        validation,
        'utf8',
      );
    }
    console.log(`  prisma/${domain}/${fileName}`);
  }
}

function restructurePrisma() {
  const legacyExists = fs.existsSync(path.join(LEGACY_IAM, '001-currencies'));
  if (!legacyExists) {
    console.log('\n=== Prisma restructure skipped (no legacy prisma/iam/001-* folders) ===\n');
    return;
  }

  console.log('\n=== Prisma restructure ===\n');

  const sharedDir = path.join(PRISMA, 'shared');
  ensureDir(sharedDir);

  const enumsSrc = path.join(LEGACY_IAM, '_enums.prisma');
  if (fs.existsSync(enumsSrc)) {
    fs.copyFileSync(enumsSrc, path.join(sharedDir, 'enums.prisma'));
    console.log('  prisma/shared/enums.prisma');
  }

  const currenciesBody = readModelBody('001-currencies');
  if (currenciesBody) {
    fs.writeFileSync(
      path.join(sharedDir, 'currencies.prisma'),
      `// shared | currencies\n\n${currenciesBody}\n`,
      'utf8',
    );
    console.log('  prisma/shared/currencies.prisma');
  }

  const currenciesVal = readValidation('001-currencies');
  if (currenciesVal) {
    ensureDir(path.join(sharedDir, 'validation'));
    fs.writeFileSync(
      path.join(sharedDir, 'validation', 'currencies.validation.sql'),
      currenciesVal,
      'utf8',
    );
  }

  fs.writeFileSync(path.join(sharedDir, 'countries.prisma'), COUNTRIES_STUB, 'utf8');
  console.log('  prisma/shared/countries.prisma (placeholder)');

  for (const [dest, src] of [
    ['functions.sql', '000_validation_functions.sql'],
    ['indexes.sql', '035_indexes.sql'],
  ]) {
    const srcPath = path.join(LEGACY_IAM, src);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(sharedDir, dest));
      console.log(`  prisma/shared/${dest}`);
    }
  }

  for (const [domain, config] of Object.entries(PRISMA_DOMAINS)) {
    if (domain === 'shared') continue;
    console.log(`\n  [${domain}]`);
    movePrismaDomain(domain, config.tables);
  }

  for (const domain of EMPTY_PRISMA_DOMAINS) {
    writeGitkeep(path.join(PRISMA, domain));
    console.log(`  prisma/${domain}/.gitkeep`);
  }

  // Remove legacy per-table folders (001-xxx) if present under any domain
  for (const domain of ['iam', 'organization', 'subscription', 'audit', 'shared']) {
    const domainDir = path.join(PRISMA, domain);
    if (!fs.existsSync(domainDir)) continue;
    for (const entry of fs.readdirSync(domainDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d{3}-/.test(entry.name)) {
        fs.rmSync(path.join(domainDir, entry.name), { recursive: true, force: true });
        console.log(`  removed legacy prisma/${domain}/${entry.name}`);
      }
    }
  }
}

function moveDir(src, dest) {
  const srcPath = path.join(SRC, src);
  const destPath = path.join(SRC, dest);
  if (!fs.existsSync(srcPath)) return false;
  ensureDir(path.dirname(destPath));
  if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });
  fs.cpSync(srcPath, destPath, { recursive: true });
  fs.rmSync(srcPath, { recursive: true, force: true });
  return true;
}

function restructureSrc() {
  console.log('\n=== src restructure ===\n');

  for (const [from, to] of SRC_MODULE_MOVES) {
    if (moveDir(from, to)) console.log(`  ${from} -> ${to}`);
  }

  for (const dir of SRC_PLACEHOLDER_DIRS) {
    writeGitkeep(path.join(SRC, dir));
  }
  console.log(`  created ${SRC_PLACEHOLDER_DIRS.length} module placeholder dirs`);

  for (const dir of INFRA_PLACEHOLDER_DIRS) {
    writeGitkeep(path.join(SRC, dir));
  }

  writeGitkeep(path.join(SRC, 'common', 'enums'));
  writeGitkeep(path.join(SRC, 'common', 'pipes'));
  writeGitkeep(path.join(SRC, 'common', 'validators'));

  for (const dir of DOCS_DIRS) writeGitkeep(path.join(ROOT, dir));
  for (const dir of TEST_DIRS) writeGitkeep(path.join(ROOT, dir));

  const jobsDir = path.join(SRC, 'jobs');
  ensureDir(jobsDir);
  for (const file of JOB_FILES) {
    const full = path.join(SRC, file);
    if (!fs.existsSync(full)) {
      const name = path.basename(file, '.ts');
      fs.writeFileSync(
        full,
        `// Placeholder: ${name}\nexport const ${name.replace(/[.-]/g, '_')} = 'pending';\n`,
        'utf8',
      );
    }
  }
  console.log('  created src/jobs/ placeholders');
}

function writeConfigFiles() {
  console.log('\n=== config split ===\n');
  const configDir = path.join(SRC, 'config');
  ensureDir(configDir);

  const files = {
    'app.config.ts': `export const appConfig = () => ({
  name: process.env.APP_NAME || 'ERP Backend',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
});
`,
    'database.config.ts': `export const databaseConfig = () => ({
  url: process.env.DATABASE_URL,
});
`,
    'jwt.config.ts': `export const jwtConfig = () => ({
  secret: process.env.JWT_SECRET || 'change-me-in-production',
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
});
`,
    'mail.config.ts': `export const mailConfig = () => ({
  host: process.env.MAIL_HOST,
  port: parseInt(process.env.MAIL_PORT || '587', 10),
  user: process.env.MAIL_USER,
  password: process.env.MAIL_PASSWORD,
  from: process.env.MAIL_FROM || 'noreply@erp.local',
});
`,
    'storage.config.ts': `export const storageConfig = () => ({
  projectId: process.env.GCS_PROJECT_ID,
  bucket: process.env.GCS_BUCKET,
  keyFilePath: process.env.GCS_KEY_FILE_PATH,
  publicBaseUrl: process.env.GCS_PUBLIC_BASE_URL,
});
`,
    'queue.config.ts': `export const queueConfig = () => ({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    useMemory: process.env.USE_MEMORY_SESSION === 'true',
  },
  bullmq: {
    prefix: process.env.BULLMQ_PREFIX || 'erp',
  },
});
`,
  };

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(configDir, name), content, 'utf8');
    console.log(`  src/config/${name}`);
  }

  const configuration = `import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { jwtConfig } from './jwt.config';
import { mailConfig } from './mail.config';
import { storageConfig } from './storage.config';
import { queueConfig } from './queue.config';

export default () => {
  const queue = queueConfig();
  return {
    app: appConfig(),
    database: databaseConfig(),
    jwt: jwtConfig(),
    mail: mailConfig(),
    gcs: storageConfig(),
    redis: queue.redis,
    bullmq: queue.bullmq,
  };
};
`;
  fs.writeFileSync(path.join(configDir, 'configuration.ts'), configuration, 'utf8');
}

function writeReadme() {
  const readme = `# ERP Backend

Multi-tenant Manufacturing ERP — NestJS + Prisma + PostgreSQL.

## Structure

- \`prisma/\` — database schemas by domain (shared, iam, organization, subscription, …)
- \`src/modules/\` — NestJS API modules by domain
- \`src/infrastructure/\` — prisma, cache, queue, storage, email, …
- \`docs/\` — architecture, ER diagrams, API specs

## Commands

\`\`\`bash
npm install
npm run start:dev
npx prisma validate
npm run prisma:migrate
npm run prisma:validate-db
\`\`\`
`;
  fs.writeFileSync(path.join(ROOT, 'README.md'), readme, 'utf8');
  console.log('\n  README.md');
}

const args = process.argv.slice(2);
const srcOnly = args.includes('--src-only');

if (!srcOnly) restructurePrisma();
restructureSrc();
writeConfigFiles();
writeReadme();
console.log('\nDone. Run: npx prisma validate && npm run build\n');
