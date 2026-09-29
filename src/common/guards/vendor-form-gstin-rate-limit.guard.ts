import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BusinessException } from '@/common/exceptions/business.exception';

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 5;

/**
 * Public GSTIN verify spends paid gstinapi.in credits, so it is capped per invitation token
 * (in addition to the per-IP vendor form limit). Counters are per Cloud Run instance.
 */
@Injectable()
export class VendorFormGstinRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = String(request.params?.token ?? '');
    const now = Date.now();

    this.pruneExpired(now);

    let bucket = this.buckets.get(token);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      this.buckets.set(token, bucket);
    }

    bucket.count += 1;
    if (bucket.count > MAX_REQUESTS) {
      throw new BusinessException(
        'Too many GSTIN verification attempts. Please try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
        undefined,
        'VENDOR_FORM_GSTIN_RATE_LIMIT',
      );
    }

    return true;
  }

  private pruneExpired(now: number) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
