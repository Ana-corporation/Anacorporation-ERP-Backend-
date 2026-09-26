import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BusinessException } from '@/common/exceptions/business.exception';

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

@Injectable()
export class VendorFormRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      'unknown';
    const token = request.params?.token ?? '';
    const key = `${ip}:${token.slice(0, 8)}`;
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > MAX_REQUESTS) {
      throw new BusinessException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        undefined,
        'VENDOR_FORM_RATE_LIMIT',
      );
    }

    return true;
  }
}
