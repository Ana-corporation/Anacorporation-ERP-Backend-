/**
 * Copies shared git hooks into .git/hooks so every clone/install gets post-merge.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const gitDir = path.join(root, '.git');
const hooksSrc = path.join(__dirname, 'git-hooks');
const hooksDest = path.join(gitDir, 'hooks');

if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
  process.exit(0);
}

if (!fs.existsSync(hooksSrc)) process.exit(0);
fs.mkdirSync(hooksDest, { recursive: true });

for (const name of fs.readdirSync(hooksSrc)) {
  const src = path.join(hooksSrc, name);
  const dest = path.join(hooksDest, name);
  fs.copyFileSync(src, dest);
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    // Windows: chmod is optional
  }
}
