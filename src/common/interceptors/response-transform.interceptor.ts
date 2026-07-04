import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'success' in data) {
          return data as unknown as ApiResponse<T>;
        }

        const meta =
          data && typeof data === 'object' && 'meta' in data
            ? (data as { meta: Record<string, unknown> }).meta
            : undefined;

        const payload =
          data && typeof data === 'object' && 'data' in data
            ? (data as { data: T }).data
            : data;

        return {
          success: true,
          message: 'Success',
          data: payload as T,
          meta,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
