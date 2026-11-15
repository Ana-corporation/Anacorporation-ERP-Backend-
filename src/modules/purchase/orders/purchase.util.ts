import { createHash } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException, ConflictException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export type PurchaseTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export const D = (value: Prisma.Decimal | string | number) => new Prisma.Decimal(value);

export function money(value: Prisma.Decimal | string | number | null | undefined): string {
  return D(value ?? 0).toFixed(6);
}

export function day(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return iso.slice(0, 10);
}

export function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function fail(message: string, code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new BusinessException(message, status, undefined, code);
}

export function conflict(message: string, code = 'ROW_VERSION_CONFLICT'): never {
  throw new ConflictException(message, code);
}

export function assertRowVersion(current: number, sent: number) {
  if (current !== sent) conflict('Changed by someone else. Reload?');
}

export async function audit(
  tx: PurchaseTx,
  companyId: bigint,
  userId: bigint,
  action: UserAuditAction,
  entityName: string,
  entityId: bigint,
  newValue: unknown,
) {
  await tx.userAudit.create({
    data: {
      companyId,
      userId,
      performedBy: userId,
      action,
      entityName,
      entityId,
      newValue: serialize(newValue) as Prisma.InputJsonValue,
    },
  });
}

export async function nextNumber(
  tx: PurchaseTx,
  companyId: bigint,
  prefix: 'PR' | 'PO',
): Promise<string> {
  const lockKey = `purchase_number:${companyId}:${prefix}`;
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS l`;
  const table = prefix === 'PR' ? 'purchase_requirements' : 'purchase_orders';
  const column = prefix === 'PR' ? 'pr_no' : 'po_no';
  const rows = await tx.$queryRawUnsafe<{ n: string | null }[]>(
    `SELECT ${column} AS n FROM ${table} WHERE company_id = $1 AND ${column} LIKE $2 ORDER BY ${column} DESC LIMIT 1`,
    companyId,
    `${prefix}-%`,
  );
  const last = rows[0]?.n ? Number(rows[0].n.slice(prefix.length + 1)) || 0 : 0;
  return `${prefix}-${String(last + 1).padStart(6, '0')}`;
}

export function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

type IdemRow = { request_hash: string; response_body: unknown };

/** Same Idempotency-Key + same body returns the first response. A different body is rejected. */
export async function withIdempotency<T>(
  prisma: PrismaService,
  companyId: bigint,
  userId: bigint,
  endpoint: string,
  key: string | undefined,
  body: unknown,
  run: (tx: PurchaseTx) => Promise<T>,
): Promise<T> {
  const idempotencyKey = key?.trim();
  if (!idempotencyKey) fail('Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED');
  const hash = requestHash(body);
  return prisma.$transaction(async (tx) => {
    const lockKey = `idem:${companyId}:${endpoint}:${idempotencyKey}`;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS l`;
    const existing = await tx.$queryRaw<IdemRow[]>`
      SELECT request_hash, response_body
      FROM idempotency_keys
      WHERE company_id = ${companyId} AND endpoint = ${endpoint} AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    if (existing[0]) {
      if (existing[0].request_hash !== hash) {
        conflict('This Idempotency-Key was already used for a different request', 'IDEMPOTENCY_KEY_REUSED');
      }
      return existing[0].response_body as T;
    }
    const result = await run(tx);
    const payload = JSON.stringify(serialize(result));
    await tx.$executeRaw`
      INSERT INTO idempotency_keys (
        company_id, user_id, endpoint, idempotency_key, request_hash,
        response_status, response_body, created_at, expires_at
      ) VALUES (
        ${companyId}, ${userId}, ${endpoint}, ${idempotencyKey}, ${hash},
        200, CAST(${payload} AS jsonb), NOW(), NOW() + INTERVAL '24 hours'
      )
    `;
    return result;
  }, { timeout: 30000, maxWait: 10000 });
}
