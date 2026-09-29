import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { VendorFormGstinRateLimitGuard } from './vendor-form-gstin-rate-limit.guard';

function contextFor(token: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params: { token } }) }),
  } as unknown as ExecutionContext;
}

describe('VendorFormGstinRateLimitGuard', () => {
  afterEach(() => jest.useRealTimers());

  it('allows 5 calls per token, then returns 429', () => {
    const guard = new VendorFormGstinRateLimitGuard();
    for (let i = 0; i < 5; i += 1) {
      expect(guard.canActivate(contextFor('token-a'))).toBe(true);
    }
    expect(() => guard.canActivate(contextFor('token-a'))).toThrow(
      expect.objectContaining({ status: HttpStatus.TOO_MANY_REQUESTS }),
    );
  });

  it('counts each token separately', () => {
    const guard = new VendorFormGstinRateLimitGuard();
    for (let i = 0; i < 5; i += 1) guard.canActivate(contextFor('token-a'));
    expect(guard.canActivate(contextFor('token-b'))).toBe(true);
  });

  it('resets after 10 minutes', () => {
    jest.useFakeTimers();
    const guard = new VendorFormGstinRateLimitGuard();
    for (let i = 0; i < 5; i += 1) guard.canActivate(contextFor('token-a'));

    jest.advanceTimersByTime(10 * 60_000 + 1);
    expect(guard.canActivate(contextFor('token-a'))).toBe(true);
  });
});
