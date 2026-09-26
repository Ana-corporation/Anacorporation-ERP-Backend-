import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UnauthorizedException } from '@/common/exceptions/business.exception';

@Injectable()
export class SchedulerAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.configService.get<string>('app.schedulerSecret');
    if (!secret) {
      throw new UnauthorizedException('Scheduler endpoint is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-scheduler-secret'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || provided !== secret) {
      throw new UnauthorizedException('Invalid scheduler credentials');
    }

    return true;
  }
}
