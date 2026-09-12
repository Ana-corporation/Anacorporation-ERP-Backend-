'use strict';

/**
 * Bind PORT before loading Nest. Import failures must not kill the container.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const fromDist = path.join(process.cwd(), 'dist', request.slice(2));
    const js = fromDist.endsWith('.js') ? fromDist : `${fromDist}.js`;
    const indexJs = path.join(fromDist, 'index.js');
    if (fs.existsSync(js)) request = js;
    else if (fs.existsSync(indexJs)) request = indexJs;
  }
  return origResolve.call(this, request, parent, isMain, options);
};

const port = Number(process.env.PORT) || 8080;

function startingHandler(req, res) {
  const url = (req.url || '/').split('?')[0];
  // Only /health/live is "process is up". /health stays 503 until Nest attaches
  // so Cloud Run HTTP startup probes keep CPU allocated during boot.
  const live = url === '/health/live';
  res.writeHead(live ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'starting',
      service: 'anacorporation-erp-backend',
      timestamp: new Date().toISOString(),
    }),
  );
}

const server = http.createServer(startingHandler);
global.__ancEarlyServer = server;
global.__ancStartingHandler = startingHandler;

server.listen(port, '0.0.0.0', () => {
  console.log(`cloud-run-entry: listening on 0.0.0.0:${port}`);

  const candidates = [
    path.join(process.cwd(), 'dist', 'main.js'),
    path.join(process.cwd(), 'dist', 'src', 'main.js'),
  ];
  const main = candidates.find((file) => fs.existsSync(file));
  if (!main) {
    console.error('cloud-run-entry: Nest entry not found', candidates);
    return;
  }

  console.log(`cloud-run-entry: loading ${main}`);
  try {
    require(main);
    console.log('cloud-run-entry: Nest module loaded, bootstrap running');
  } catch (err) {
    console.error('cloud-run-entry: failed to load Nest app', err);
  }

  setTimeout(() => {
    if (!global.__ancNestReady) {
      console.error('cloud-run-entry: Nest did not attach within 90s — login will stay 503 starting');
    }
  }, 90000);
});
