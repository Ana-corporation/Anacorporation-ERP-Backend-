import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { parseDurationToSeconds } from '@/common/utils/duration.util';
import { UnauthorizedException } from '@/common/exceptions/business.exception';
import {
  AUTH_REDIS_KEYS,
  CompanySessionData,
  SuperAdminSessionData,
} from './auth-session.types';

export interface CreateCompanySessionParams {
  userId: string;
  companyId: string;
  sessionTimeoutMin: number;
  existingSessionId?: string;
  existingFamilyId?: string;
}

export interface CreateSuperAdminSessionParams {
  superAdminId: string;
  existingSessionId?: string;
  existingFamilyId?: string;
}

function resolveIdleFloorMin(): number {
  const raw = Number(process.env.SESSION_IDLE_FLOOR_MIN || 480);
  return Number.isFinite(raw) && raw > 0 ? raw : 480;
}

@Injectable()
export class AuthSessionService {
  readonly refreshTtlSeconds: number;
  private readonly idleFloorMin: number;

  constructor(
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    const refreshExpiration =
      configService.get<string>('jwt.refreshExpiration') || '7d';
    this.refreshTtlSeconds = parseDurationToSeconds(refreshExpiration, 7 * 86400);
    this.idleFloorMin = resolveIdleFloorMin();
  }

  async createCompanySession(params: CreateCompanySessionParams) {
    const sid = params.existingSessionId ?? uuidv4();
    const tokenFamilyId = params.existingFamilyId ?? uuidv4();
    const refreshToken = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const now = Date.now();

    const sessionData: CompanySessionData = {
      userId: params.userId,
      companyId: params.companyId,
      refreshTokenHash,
      tokenFamilyId,
      lastActivityAt: now,
      sessionTimeoutMin: params.sessionTimeoutMin,
    };

    const ttl = this.resolveSessionTtl(params.sessionTimeoutMin);

    await this.redisService.setJson(AUTH_REDIS_KEYS.session(sid), sessionData, ttl);
    await this.redisService.set(AUTH_REDIS_KEYS.refresh(refreshToken), sid, ttl);
    await this.trackFamilySession(tokenFamilyId, sid, ttl);
    await this.trackUserSession(params.userId, params.companyId, sid, ttl);

    return { sid, refreshToken, tokenFamilyId };
  }

  async rotateCompanyRefresh(refreshToken: string) {
    const sessionId = await this.redisService.get(AUTH_REDIS_KEYS.refresh(refreshToken));

    if (!sessionId) {
      const reusedFamily = await this.redisService.get(
        AUTH_REDIS_KEYS.refreshUsed(refreshToken),
      );
      if (reusedFamily) {
        await this.revokeCompanyFamily(reusedFamily);
        throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.redisService.getJson<CompanySessionData>(
      AUTH_REDIS_KEYS.session(sessionId),
    );
    if (!session) {
      throw new UnauthorizedException('Session expired');
    }

    const valid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.assertSessionNotIdle(session);

    await this.redisService.set(
      AUTH_REDIS_KEYS.refreshUsed(refreshToken),
      session.tokenFamilyId,
      this.refreshTtlSeconds,
    );
    await this.redisService.del(AUTH_REDIS_KEYS.refresh(refreshToken));
    await this.untrackUserSession(session.userId, session.companyId, sessionId);

    return {
      userId: session.userId,
      companyId: session.companyId,
      sessionId,
      tokenFamilyId: session.tokenFamilyId,
      sessionTimeoutMin: session.sessionTimeoutMin,
    };
  }

  async validateCompanySession(sessionId: string): Promise<boolean> {
    const session = await this.redisService.getJson<CompanySessionData>(
      AUTH_REDIS_KEYS.session(sessionId),
    );
    if (!session) return false;

    try {
      await this.assertSessionNotIdle(session);
    } catch {
      await this.revokeCompanySession(sessionId, session);
      return false;
    }

    session.lastActivityAt = Date.now();
    // Upgrade legacy sessions that still carry a sub-floor idle stamp.
    if (!session.sessionTimeoutMin || session.sessionTimeoutMin < this.idleFloorMin) {
      session.sessionTimeoutMin = this.idleFloorMin;
    }
    const ttl = this.resolveSessionTtl(session.sessionTimeoutMin);
    await this.redisService.setJson(AUTH_REDIS_KEYS.session(sessionId), session, ttl);
    return true;
  }

  async revokeCompanySessionByRefreshToken(refreshToken: string) {
    const sessionId = await this.redisService.get(AUTH_REDIS_KEYS.refresh(refreshToken));
    if (!sessionId) return;

    const session = await this.redisService.getJson<CompanySessionData>(
      AUTH_REDIS_KEYS.session(sessionId),
    );
    await this.revokeCompanySession(sessionId, session ?? undefined);
    await this.redisService.del(AUTH_REDIS_KEYS.refresh(refreshToken));
  }

  async revokeCompanySessionById(sessionId: string) {
    const session = await this.redisService.getJson<CompanySessionData>(
      AUTH_REDIS_KEYS.session(sessionId),
    );
    await this.revokeCompanySession(sessionId, session ?? undefined);
  }

  async enforceConcurrentSessionPolicy(
    userId: string,
    companyId: string,
    allowMultipleLogins: boolean,
    maxConcurrentSessions?: number | null,
  ) {
    const key = AUTH_REDIS_KEYS.userSessions(userId, companyId);
    const sids = (await this.redisService.getJson<string[]>(key)) ?? [];

    if (!allowMultipleLogins && sids.length > 0) {
      for (const sid of sids) {
        await this.revokeCompanySessionById(sid);
      }
      return;
    }

    if (maxConcurrentSessions && sids.length >= maxConcurrentSessions) {
      const overflow = sids.length - maxConcurrentSessions + 1;
      for (const sid of sids.slice(0, overflow)) {
        await this.revokeCompanySessionById(sid);
      }
    }
  }

  async createSuperAdminSession(params: CreateSuperAdminSessionParams) {
    const sessionId = params.existingSessionId ?? uuidv4();
    const tokenFamilyId = params.existingFamilyId ?? uuidv4();
    const refreshToken = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const now = Date.now();

    const sessionData: SuperAdminSessionData = {
      superAdminId: params.superAdminId,
      refreshTokenHash,
      tokenFamilyId,
      lastActivityAt: now,
    };

    await this.redisService.setJson(
      AUTH_REDIS_KEYS.superAdminSession(sessionId),
      sessionData,
      this.refreshTtlSeconds,
    );
    await this.redisService.set(
      AUTH_REDIS_KEYS.superAdminRefresh(refreshToken),
      sessionId,
      this.refreshTtlSeconds,
    );
    await this.trackSuperAdminFamily(sessionId, tokenFamilyId);

    return { sessionId, refreshToken, tokenFamilyId };
  }

  async rotateSuperAdminRefresh(refreshToken: string) {
    const sessionId = await this.redisService.get(
      AUTH_REDIS_KEYS.superAdminRefresh(refreshToken),
    );

    if (!sessionId) {
      const reusedFamily = await this.redisService.get(
        AUTH_REDIS_KEYS.superAdminRefreshUsed(refreshToken),
      );
      if (reusedFamily) {
        await this.revokeSuperAdminFamily(reusedFamily);
        throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.redisService.getJson<SuperAdminSessionData>(
      AUTH_REDIS_KEYS.superAdminSession(sessionId),
    );
    if (!session) {
      throw new UnauthorizedException('Session expired');
    }

    const valid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.redisService.set(
      AUTH_REDIS_KEYS.superAdminRefreshUsed(refreshToken),
      session.tokenFamilyId,
      this.refreshTtlSeconds,
    );
    await this.redisService.del(AUTH_REDIS_KEYS.superAdminRefresh(refreshToken));

    return {
      superAdminId: session.superAdminId,
      sessionId,
      tokenFamilyId: session.tokenFamilyId,
    };
  }

  async validateSuperAdminSession(sessionId: string): Promise<boolean> {
    const session = await this.redisService.getJson<SuperAdminSessionData>(
      AUTH_REDIS_KEYS.superAdminSession(sessionId),
    );
    if (!session) return false;

    session.lastActivityAt = Date.now();
    await this.redisService.setJson(
      AUTH_REDIS_KEYS.superAdminSession(sessionId),
      session,
      this.refreshTtlSeconds,
    );
    return true;
  }

  async revokeSuperAdminByRefreshToken(refreshToken: string) {
    const sessionId = await this.redisService.get(
      AUTH_REDIS_KEYS.superAdminRefresh(refreshToken),
    );
    if (sessionId) {
      await this.revokeSuperAdminSession(sessionId);
      await this.redisService.del(AUTH_REDIS_KEYS.superAdminRefresh(refreshToken));
    }
  }

  async revokeSuperAdminSession(sessionId: string) {
    const session = await this.redisService.getJson<SuperAdminSessionData>(
      AUTH_REDIS_KEYS.superAdminSession(sessionId),
    );
    await this.redisService.del(AUTH_REDIS_KEYS.superAdminSession(sessionId));
    if (session) {
      await this.untrackSuperAdminFamily(session.tokenFamilyId, sessionId);
    }
  }

  private resolveSessionTtl(sessionTimeoutMin: number): number {
    const idleTtl = Math.max(sessionTimeoutMin * 60, 60);
    return Math.min(this.refreshTtlSeconds, idleTtl);
  }

  private async assertSessionNotIdle(session: CompanySessionData) {
    const timeoutMin = Math.max(session.sessionTimeoutMin || 0, this.idleFloorMin);
    const idleLimitMs = timeoutMin * 60 * 1000;
    if (Date.now() - session.lastActivityAt > idleLimitMs) {
      throw new UnauthorizedException('Session idle timeout exceeded');
    }
  }

  private async trackFamilySession(familyId: string, sid: string, ttl: number) {
    const key = AUTH_REDIS_KEYS.familySessions(familyId);
    const existing = (await this.redisService.getJson<string[]>(key)) ?? [];
    if (!existing.includes(sid)) {
      existing.push(sid);
    }
    await this.redisService.setJson(key, existing, ttl);
  }

  private async trackUserSession(
    userId: string,
    companyId: string,
    sid: string,
    ttl: number,
  ) {
    const key = AUTH_REDIS_KEYS.userSessions(userId, companyId);
    const existing = (await this.redisService.getJson<string[]>(key)) ?? [];
    if (!existing.includes(sid)) {
      existing.push(sid);
    }
    await this.redisService.setJson(key, existing, ttl);
  }

  private async untrackUserSession(userId: string, companyId: string, sid: string) {
    const key = AUTH_REDIS_KEYS.userSessions(userId, companyId);
    const existing = (await this.redisService.getJson<string[]>(key)) ?? [];
    const next = existing.filter((value) => value !== sid);
    if (next.length === 0) {
      await this.redisService.del(key);
      return;
    }
    await this.redisService.setJson(key, next, this.refreshTtlSeconds);
  }

  private async revokeCompanySession(sessionId: string, session?: CompanySessionData) {
    await this.redisService.del(AUTH_REDIS_KEYS.session(sessionId));
    if (session) {
      await this.untrackUserSession(session.userId, session.companyId, sessionId);
      await this.untrackFamilySession(session.tokenFamilyId, sessionId);
    }
  }

  private async untrackFamilySession(familyId: string, sid: string) {
    const key = AUTH_REDIS_KEYS.familySessions(familyId);
    const existing = (await this.redisService.getJson<string[]>(key)) ?? [];
    const next = existing.filter((value) => value !== sid);
    if (next.length === 0) {
      await this.redisService.del(key);
      return;
    }
    await this.redisService.setJson(key, next, this.refreshTtlSeconds);
  }

  private async revokeCompanyFamily(familyId: string) {
    const sids =
      (await this.redisService.getJson<string[]>(AUTH_REDIS_KEYS.familySessions(familyId))) ??
      [];
    for (const sid of sids) {
      const session = await this.redisService.getJson<CompanySessionData>(
        AUTH_REDIS_KEYS.session(sid),
      );
      await this.revokeCompanySession(sid, session ?? undefined);
    }
    await this.redisService.del(AUTH_REDIS_KEYS.familySessions(familyId));
  }

  private async trackSuperAdminFamily(sessionId: string, familyId: string) {
    const key = AUTH_REDIS_KEYS.superAdminFamily(familyId);
    const existing = (await this.redisService.getJson<string[]>(key)) ?? [];
    if (!existing.includes(sessionId)) {
      existing.push(sessionId);
    }
    await this.redisService.setJson(key, existing, this.refreshTtlSeconds);
  }

  private async untrackSuperAdminFamily(familyId: string, sessionId: string) {
    const key = AUTH_REDIS_KEYS.superAdminFamily(familyId);
    const existing = (await this.redisService.getJson<string[]>(key)) ?? [];
    const next = existing.filter((value) => value !== sessionId);
    if (next.length === 0) {
      await this.redisService.del(key);
      return;
    }
    await this.redisService.setJson(key, next, this.refreshTtlSeconds);
  }

  private async revokeSuperAdminFamily(familyId: string) {
    const sids =
      (await this.redisService.getJson<string[]>(AUTH_REDIS_KEYS.superAdminFamily(familyId))) ??
      [];
    for (const sid of sids) {
      await this.revokeSuperAdminSession(sid);
    }
    await this.redisService.del(AUTH_REDIS_KEYS.superAdminFamily(familyId));
  }
}
