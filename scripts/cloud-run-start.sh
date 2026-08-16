#!/bin/sh
set -eu

echo "Applying Prisma migrations..."
npx prisma migrate deploy

if [ -f dist/main.js ]; then
  exec node dist/main.js
fi

if [ -f dist/src/main.js ]; then
  exec node dist/src/main.js
fi

echo "Compiled Nest entry not found (dist/main.js or dist/src/main.js)." >&2
exit 1
