# ERP Backend

Multi-tenant Manufacturing ERP — NestJS + Prisma + PostgreSQL.

## Structure

- `prisma/` — database schemas by domain (shared, iam, organization, subscription, …)
- `src/modules/` — NestJS API modules by domain
- `src/infrastructure/` — prisma, cache, queue, storage, email, …
- `docs/` — architecture, ER diagrams, API specs

## Commands

```bash
npm install
npm run start:dev
npx prisma validate
npm run prisma:migrate
npm run prisma:validate-db
```
