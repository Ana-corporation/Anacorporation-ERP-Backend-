require('./apply-gcp-sql-env');

const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
const result = spawnSync('npx', ['prisma', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
