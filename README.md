# ERP Backend

Multi-tenant Manufacturing ERP — NestJS + Prisma + PostgreSQL.

## Structure

- `prisma/` — database schemas by domain (shared, iam, organization, subscription, …)
- `src/modules/` — NestJS API modules by domain
- `src/infrastructure/` — prisma, cache, queue, storage, email, …
- `docs/` — architecture, ER diagrams, API specs

## Local sessions (Redis)

Local/dev sessions need **Redis**. Set `USE_MEMORY_SESSION=false` and start Redis:

```bash
# Docker Desktop must be running first
docker start erp-redis
# or first time:
docker run -d --name erp-redis -p 6379:6379 redis:7
```

If Docker Desktop is stopped, nothing listens on `:6379` and you get `ECONNREFUSED`. Nest then falls back to memory sessions and disables BullMQ (probe runs before AppModule load).

`USE_MEMORY_SESSION=true` is emergency/dev-only; the disk file `.erp-memory-sessions.json` is **not** for production.

Production must use `USE_MEMORY_SESSION=false` with Redis reachable (enforced in `env.validation`).

Check store mode: `GET /api/v1/health` → `sessionStore` (`redis` | `memory-disk`) and `redisOk`.

## Commands

```bash
npm install
npm run start:dev
npx prisma validate
npm run prisma:migrate
npm run prisma:validate-db
```
