export type InviteStatus = 'pending' | 'accepted' | 'expired';

export function computeInviteStatus(params: {
  lastSuccessfulLogin: Date | null | undefined;
  mustChangePassword: boolean | null | undefined;
  passwordExpiresDate: Date | null | undefined;
  now?: Date;
}): InviteStatus {
  const now = params.now ?? new Date();
  if (params.lastSuccessfulLogin) return 'accepted';
  if (
    params.mustChangePassword &&
    params.passwordExpiresDate &&
    params.passwordExpiresDate.getTime() < now.getTime()
  ) {
    return 'expired';
  }
  return 'pending';
}
