#!/bin/sh
set -eu

# Cloud Run kills the revision if nothing listens on $PORT quickly.
# Do not run prisma migrate (or any DB wait) before the HTTP server binds.
if [ -f dist/main.js ]; then
  exec node dist/main.js
fi

if [ -f dist/src/main.js ]; then
  exec node dist/src/main.js
fi

echo "Compiled Nest entry not found (dist/main.js or dist/src/main.js)." >&2
exit 1
