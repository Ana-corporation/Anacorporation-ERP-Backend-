import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { BusinessException } from '@/common/exceptions/business.exception';
import { VENDOR_FORM_ERROR_CODES } from './vendor-form.constants';
import { VENDOR_FORM_ATTACHMENT_MAX_FILES } from './vendor-form-attachments.util';

/** Multer stops oversized or extra files before the service runs; give those the vendor form codes. */
@Injectable()
export class VendorFormUploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => throwError(() => this.translate(error))),
    );
  }

  private translate(error: unknown): unknown {
    if (error instanceof PayloadTooLargeException) {
      return new BusinessException(
        'File is larger than 10 MB',
        HttpStatus.BAD_REQUEST,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENT_TOO_LARGE,
      );
    }
    if (error instanceof BadRequestException && this.isFileCountError(error.message)) {
      return new BusinessException(
        `You can upload up to ${VENDOR_FORM_ATTACHMENT_MAX_FILES} files`,
        HttpStatus.BAD_REQUEST,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENT_LIMIT,
      );
    }
    return error;
  }

  /** "Unexpected field" on the declared fields means a field went over its maxCount. */
  private isFileCountError(message: string) {
    return (
      message === 'Too many files' ||
      message === 'Unexpected field - files' ||
      message === 'Unexpected field - file'
    );
  }
}
