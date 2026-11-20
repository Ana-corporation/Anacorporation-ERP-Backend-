import { createHash } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';

export const IDEMPOTENCY_ERROR_CODES = {
  REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  REUSED: 'IDEMPOTENCY_KEY_REUSED',
  INVALID: 'IDEMPOTENCY_KEY_INVALID',
} as const;

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyContext {
  companyId: bigint;
  userId?: bigint | null;
  /** Logical operation, e.g. "POST boms/:bomId/release" */
  endpoint: string;
  key: string | undefined;
  /** Hashed to detect the same key reused with a different request */
  body: unknown;
}

/** Stable JSON (sorted keys) so equal payloads hash equally. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Idempotency-Key handling inside the caller's transaction. The key row is inserted in the same
 * transaction as the work, so a rollback also releases the key; a concurrent duplicate waits on the
 * unique index, then reads the committed response instead of repeating the work.
 */
@Injectable()
export class IdempotencyService {
  async run<T extends Prisma.InputJsonValue>(
    tx: Prisma.TransactionClient,
    ctx: IdempotencyContext,
    work: () => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    const key = ctx.key?.trim();
    if (!key) {
      throw new BusinessException(
        'Idempotency-Key header is required for this action',
        HttpStatus.BAD_REQUEST,
        [{ field: 'Idempotency-Key', message: 'Required', code: IDEMPOTENCY_ERROR_CODES.REQUIRED }],
        IDEMPOTENCY_ERROR_CODES.REQUIRED,
      );
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BusinessException(
        'Idempotency-Key must be 8-80 characters (letters, digits, . _ : -)',
        HttpStatus.BAD_REQUEST,
        [{ field: 'Idempotency-Key', message: 'Invalid format', code: IDEMPOTENCY_ERROR_CODES.INVALID }],
        IDEMPOTENCY_ERROR_CODES.INVALID,
      );
    }
    const requestHash = createHash('sha256').update(stableStringify(ctx.body)).digest('hex');

    const inserted = await tx.$queryRaw<Array<{ idempotency_key_id: bigint }>>`
      INSERT INTO idempotency_keys (company_id, user_id, endpoint, idempotency_key, request_hash, expires_at)
      VALUES (${ctx.companyId}, ${ctx.userId ?? null}, ${ctx.endpoint}, ${key}, ${requestHash},
              ${new Date(Date.now() + TTL_MS)})
      ON CONFLICT (company_id, idempotency_key, endpoint) DO NOTHING
      RETURNING idempotency_key_id`;

    if (inserted.length === 0) {
      const existing = await tx.idempotencyKey.findUnique({
        where: { companyId_idempotencyKey_endpoint: { companyId: ctx.companyId, idempotencyKey: key, endpoint: ctx.endpoint } },
      });
      if (!existing || existing.requestHash !== requestHash || existing.responseBody === null) {
        throw new BusinessException(
          'This Idempotency-Key was already used for a different request',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ field: 'Idempotency-Key', message: 'Key reused', code: IDEMPOTENCY_ERROR_CODES.REUSED }],
          IDEMPOTENCY_ERROR_CODES.REUSED,
        );
      }
      return { result: existing.responseBody as T, replayed: true };
    }

    const result = await work();
    await tx.idempotencyKey.update({
      where: { idempotencyKeyId: inserted[0].idempotency_key_id },
      data: { responseStatus: 200, responseBody: result },
    });
    return { result, replayed: false };
  }
}
