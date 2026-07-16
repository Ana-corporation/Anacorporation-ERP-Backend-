/**
 * Frees the backend PORT (Windows + Unix).
 * Used by start:dev AND right before app.listen() so long Nest/Prisma
 * boot cannot race another process onto the same port.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readPort(explicitPort) {
  if (explicitPort != null && String(explicitPort).trim() !== '') {
    return String(explicitPort);
  }
  if (process.env.PORT) return process.env.PORT;

  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/^PORT=(\d+)/m);
    if (match) return match[1];
  }

  return '3000';
}

function collectWindowsPids(port) {
  const pids = new Set();

  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
  } catch {
    // fallback below
  }

  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      // Match :3002 or ]:3002 so IPv4/IPv6 both count
      if (!new RegExp(`[:\\]]${port}\\b`).test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
  } catch {
    // no listeners
  }

  return pids;
}

function collectUnixPids(port) {
  const pids = new Set();
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
  } catch {
    // no listeners
  }
  return pids;
}

function sleepMs(ms) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Start-Sleep -Milliseconds ${ms}"`,
        { stdio: 'pipe' },
      );
    } else {
      execSync(`sleep ${Math.ceil(ms / 1000)}`, { stdio: 'pipe' });
    }
  } catch {
    // ignore
  }
}

function killPid(pid) {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
  } else {
    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
  }
}

/**
 * @param {string|number} [explicitPort]
 * @param {{ silent?: boolean }} [options]
 */
function freePort(explicitPort, options = {}) {
  const port = readPort(explicitPort);
  const log = options.silent
    ? () => undefined
    : (msg) => console.log(msg);

  const pids =
    process.platform === 'win32'
      ? collectWindowsPids(port)
      : collectUnixPids(port);

  const self = String(process.pid);
  let killed = 0;

  for (const pid of pids) {
    if (pid === self) continue;
    try {
      killPid(pid);
      log(`[free-port] Stopped PID ${pid} — port ${port} is now free`);
      killed += 1;
    } catch {
      console.warn(`[free-port] Could not stop PID ${pid}`);
    }
  }

  if (killed > 0) {
    sleepMs(600);
  } else {
    log(`[free-port] Port ${port} is already free`);
  }

  return { port, killed };
}

module.exports = { freePort, readPort };

if (require.main === module) {
  freePort();
}
