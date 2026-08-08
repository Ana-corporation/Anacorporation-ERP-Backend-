function resolveTempPasswordTtlHours(): number {
  const raw = process.env.TEMP_PASSWORD_TTL_HOURS;
  if (raw === undefined || raw === '') return 24;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.floor(n));
}

export const authSecurityConfig = () => ({
  /** Invite temporary password lifetime (hours). Min 1, default 24. */
  tempPasswordTtlHours: resolveTempPasswordTtlHours(),
});
