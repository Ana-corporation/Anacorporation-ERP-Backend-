import { HttpException, HttpStatus } from '@nestjs/common';

export type FieldError = {
  field: string;
  message: string;
};

export class BusinessException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    errors?: FieldError[],
    code?: string,
  ) {
    super(
      {
        message,
        statusCode,
        ...(errors?.length ? { errors } : {}),
        ...(code ? { code } : {}),
      },
      statusCode,
    );
  }
}

export class NotFoundException extends BusinessException {
  constructor(resource: string) {
    super(`${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictException extends BusinessException {
  constructor(message: string, code?: string) {
    super(message, HttpStatus.CONFLICT, undefined, code);
  }
}

export class UnauthorizedException extends BusinessException {
  constructor(message = 'Unauthorized') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends BusinessException {
  constructor(message = 'Forbidden') {
    super(message, HttpStatus.FORBIDDEN);
  }
}
