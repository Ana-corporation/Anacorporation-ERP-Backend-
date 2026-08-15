import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: unknown;

    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = Array.isArray(resp.message)
          ? resp.message.join(', ')
          : (resp.message as string) || message;
        errors = resp.errors;

        const { message: _m, errors: _e, statusCode: _s, ...rest } = resp;
        extra = rest;
      }
    } else if (exception instanceof Error) {
      const multerCode =
        typeof exception === 'object' && exception !== null && 'code' in exception
          ? String((exception as { code?: unknown }).code ?? '')
          : '';

      if (multerCode === 'LIMIT_FILE_SIZE') {
        status = HttpStatus.BAD_REQUEST;
        message = 'File too large (max 10 MB)';
      } else if (multerCode.startsWith('LIMIT_')) {
        status = HttpStatus.BAD_REQUEST;
        message = exception.message || 'Invalid file upload';
      } else {
        message = exception.message;
        this.logger.error(exception.message, exception.stack);
      }
    }

    response.status(status).json({
      success: false,
      message:
        Array.isArray(errors) && errors.length > 0 && typeof errors[0] === 'string'
          ? errors.join(', ')
          : message,
      data: null,
      errors: Array.isArray(errors) ? errors : undefined,
      ...extra,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
