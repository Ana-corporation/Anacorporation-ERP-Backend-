import { ConsoleLogger, LogLevel } from '@nestjs/common';

const NOISY_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
  'WebSocketsController',
]);

/**
 * Trims Nest's default boot noise: hides the per-module "dependencies
 * initialized" and per-route "Mapped {...}" lines while keeping app logs
 * (Bootstrap, PrismaService, request logs, warnings and errors).
 */
export class SimpleLogger extends ConsoleLogger {
  private isNoisy(context?: string): boolean {
    return !!context && NOISY_CONTEXTS.has(context);
  }

  log(message: unknown, context?: string): void {
    if (this.isNoisy(context)) {
      return;
    }
    super.log(message as string, context as string);
  }

  verbose(message: unknown, context?: string): void {
    if (this.isNoisy(context)) {
      return;
    }
    super.verbose(message as string, context as string);
  }

  /**
   * Drops the "[Nest] <pid>  - <date>, <time>" prefix so each line is just
   * "LOG [Context] message".
   */
  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    _pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const output = this.stringifyMessage(message, logLevel);
    const level = this.colorize(formattedLogLevel, logLevel);
    return `${level} ${contextMessage}${output}${timestampDiff}\n`;
  }
}
