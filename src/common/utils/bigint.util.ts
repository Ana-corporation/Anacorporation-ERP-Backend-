import { BadRequestException } from '@nestjs/common';

export function parseBigIntId(id: string, label = 'id'): bigint {
  if (!/^\d+$/.test(id)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return BigInt(id);
}

export function toIdString(value: bigint | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}
