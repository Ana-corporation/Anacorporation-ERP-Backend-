import { computeInviteStatus } from './invite-status.util';

describe('computeInviteStatus', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');

  it('is pending when never logged in and temp password is still valid', () => {
    expect(
      computeInviteStatus({
        lastSuccessfulLogin: null,
        mustChangePassword: true,
        passwordExpiresDate: new Date('2026-09-03T12:00:00.000Z'),
        now,
      }),
    ).toBe('pending');
  });

  it('is accepted after first successful login', () => {
    expect(
      computeInviteStatus({
        lastSuccessfulLogin: new Date('2026-09-02T11:00:00.000Z'),
        mustChangePassword: false,
        passwordExpiresDate: null,
        now,
      }),
    ).toBe('accepted');
  });

  it('is expired when temp password TTL elapsed and user never logged in', () => {
    expect(
      computeInviteStatus({
        lastSuccessfulLogin: null,
        mustChangePassword: true,
        passwordExpiresDate: new Date('2026-09-01T12:00:00.000Z'),
        now,
      }),
    ).toBe('expired');
  });
});
