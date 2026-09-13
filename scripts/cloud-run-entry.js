'use strict';

/**
 * Load Nest. Do not bind a stub server — Cloud Run must wait until Nest listens
 * so /docs and login are not 503 after scale-to-zero.
 */
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

const candidates = [
  path.join(process.cwd(), 'dist', 'main.js'),
  path.join(process.cwd(), 'dist', 'src', 'main.js'),
];
const main = candidates.find((file) => fs.existsSync(file));
if (!main) {
  console.error('cloud-run-entry: Nest entry not found', candidates);
  process.exit(1);
}

console.log(`cloud-run-entry: loading ${main}`);
require(main);
