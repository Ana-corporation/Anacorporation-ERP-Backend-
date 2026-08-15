import { AuthController } from './auth.controller';

/**
 * Public signup must not exist — users enter via company-admin invite only.
 */
describe('AuthController public signup removed', () => {
  it('does not expose a signup handler', () => {
    const proto = AuthController.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.signUp).toBe('undefined');
    expect(typeof proto.login).toBe('function');
    expect(typeof proto.changePassword).toBe('function');
  });
});
