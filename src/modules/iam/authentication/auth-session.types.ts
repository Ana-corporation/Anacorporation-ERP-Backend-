export interface CompanySessionData {
  userId: string;
  companyId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  lastActivityAt: number;
  sessionTimeoutMin: number;
}

export interface SuperAdminSessionData {
  superAdminId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  lastActivityAt: number;
}

export const AUTH_REDIS_KEYS = {
  session: (sid: string) => `session:${sid}`,
  refresh: (token: string) => `refresh:${token}`,
  refreshUsed: (token: string) => `refresh-used:${token}`,
  familySessions: (familyId: string) => `session-family:${familyId}`,
  userSessions: (userId: string, companyId: string) =>
    `user-active-sessions:${userId}:${companyId}`,
  userContext: (userId: string, companyId: string) => `userctx:${userId}:${companyId}`,
  superAdminSession: (sid: string) => `super-admin-session:${sid}`,
  superAdminRefresh: (token: string) => `super-admin-refresh:${token}`,
  superAdminRefreshUsed: (token: string) => `super-admin-refresh-used:${token}`,
  superAdminFamily: (familyId: string) => `super-admin-family:${familyId}`,
} as const;
