/**
 * Cross-platform: set NODE_ENV then spawn the remaining argv.
 * Usage: node scripts/with-node-env.js development nest start --watch
 */
const { spawnSync } = require('child_process');

const [nodeEnv, ...cmd] = process.argv.slice(2);
if (!nodeEnv || cmd.length === 0) {
  console.error('Usage: node scripts/with-node-env.js <development|production|test> <command> [...args]');
  process.exit(1);
}

process.env.NODE_ENV = nodeEnv;

const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
