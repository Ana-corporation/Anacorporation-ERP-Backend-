import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BusinessException } from '@/common/exceptions/business.exception';
import { VENDOR_FORM_ERROR_CODES } from './vendor-form.constants';
import {
  VENDOR_FORM_ATTACHMENT_UPLOADS_PER_WINDOW,
  VENDOR_FORM_ATTACHMENT_WINDOW_MS,
} from './vendor-form-attachments.util';
import { VendorFormInvitationService } from './vendor-form-invitation.service';

type Bucket = { count: number; resetAt: number };

/**
 * Public attachment upload/delete: capped per invitation token (deletes share the bucket so
 * upload/delete cycling stays bounded), and the token is validated before multer buffers
 * any file. Counters are per Cloud Run instance.
 */
@Injectable()
export class VendorFormAttachmentGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly vendorFormService: VendorFormInvitationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = String(request.params?.token ?? '');
    const now = Date.now();

    this.pruneExpired(now);

    let bucket = this.buckets.get(token);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + VENDOR_FORM_ATTACHMENT_WINDOW_MS };
      this.buckets.set(token, bucket);
    }

    bucket.count += 1;
    if (bucket.count > VENDOR_FORM_ATTACHMENT_UPLOADS_PER_WINDOW) {
      throw new BusinessException(
        'Too many uploads. Please try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENT_RATE_LIMIT,
      );
    }

    await this.vendorFormService.assertOpenInvitation(token);
    return true;
  }

  private pruneExpired(now: number) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
