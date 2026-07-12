import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * Logs one concise line per request: "GET /api/v1/users 200 12ms".
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;

    if (res.statusCode >= 500) {
      logger.error(line);
    } else if (res.statusCode >= 400) {
      logger.warn(line);
    } else {
      logger.log(line);
    }
  });

  next();
}
