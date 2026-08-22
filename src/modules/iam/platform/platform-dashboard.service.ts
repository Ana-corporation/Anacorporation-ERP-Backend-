import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'cancelled' | 'pending';

function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function daysLeft(endDate: Date | null | undefined): number | null {
  if (!endDate) return null;
  const endStr = toDateOnly(endDate);
  if (!endStr) return null;
  const endMs = new Date(`${endStr}T00:00:00Z`).getTime();
  if (Number.isNaN(endMs)) return null;
  return Math.ceil((endMs - Date.now()) / (1000 * 60 * 60 * 24));
}

const LIVE_SUB_STATUSES: SubscriptionStatus[] = ['active', 'trial', 'pending'];

@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats() {
    const companies = await this.prisma.company.findMany({
      where: {
        deletedAt: null,
        companyCode: { not: 'PLATFORM' },
      },
      select: { companyId: true, status: true },
    });

    const totalCompanies = companies.length;
    const activeCompanies = companies.filter((c) => c.status === 'active').length;
    const trialCompanies = companies.filter((c) => c.status === 'trial').length;
    const suspendedCompanies = companies.filter((c) => c.status === 'suspended').length;
    const cancelledCompanies = companies.filter((c) => c.status === 'cancelled').length;

    // Match FE derived logic (see pickCurrentSubscription in frontend):
    // - Prefer the newest subscription whose status is active|trial|pending
    // - If none exists, fall back to newest subscription of any status
    // - If a company has no subscription at all, status becomes 'none' in FE
    const nowChunkSize = 10;
    let activeSubscriptions = 0;
    let expiringSoonSubscriptions = 0;

    for (let i = 0; i < companies.length; i += nowChunkSize) {
      const chunk = companies.slice(i, i + nowChunkSize);
      const subs = await Promise.all(
        chunk.map((company) =>
          (async () => {
            const live = await this.prisma.companySubscription.findFirst({
              where: {
                companyId: company.companyId,
                deletedAt: null,
                status: { in: LIVE_SUB_STATUSES },
              },
              orderBy: { createdAt: 'desc' },
              select: { status: true, endDate: true },
            });
            if (live) return live;

            return this.prisma.companySubscription.findFirst({
              where: { companyId: company.companyId, deletedAt: null },
              orderBy: { createdAt: 'desc' },
              select: { status: true, endDate: true },
            });
          })(),
        ),
      );

      for (const sub of subs) {
        const s = sub?.status ? String(sub.status) : 'none';
        if (s && s !== 'cancelled' && s !== 'expired') {
          activeSubscriptions += 1;
        }

        const remaining = daysLeft(sub?.endDate);
        if (remaining !== null && remaining >= 0 && remaining < 30) {
          expiringSoonSubscriptions += 1;
        }
      }
    }

    return {
      totalCompanies,
      activeCompanies,
      trialCompanies,
      suspendedCompanies,
      cancelledCompanies,
      activeSubscriptions,
      expiringSoonSubscriptions,
    };
  }

  async listSubscriptions(limit: number) {
    const companies = await this.prisma.company.findMany({
      where: {
        deletedAt: null,
        companyCode: { not: 'PLATFORM' },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, limit),
      select: {
        companyId: true,
        companyCode: true,
        name: true,
        status: true,
        createdAt: true,
      },
    });

    const rows = [];
    const nowChunkSize = 10;

    for (let i = 0; i < companies.length; i += nowChunkSize) {
      const chunk = companies.slice(i, i + nowChunkSize);

      const subs = await Promise.all(
        chunk.map((company) =>
          (async () => {
            const live = await this.prisma.companySubscription.findFirst({
              where: {
                companyId: company.companyId,
                deletedAt: null,
                status: { in: LIVE_SUB_STATUSES },
              },
              orderBy: { createdAt: 'desc' },
              select: {
                companySubscriptionId: true,
                status: true,
                startDate: true,
                endDate: true,
                plan: { select: { planCode: true, name: true } },
              },
            });
            if (live) return live;

            return this.prisma.companySubscription.findFirst({
              where: { companyId: company.companyId, deletedAt: null },
              orderBy: { createdAt: 'desc' },
              select: {
                companySubscriptionId: true,
                status: true,
                startDate: true,
                endDate: true,
                plan: { select: { planCode: true, name: true } },
              },
            });
          })(),
        ),
      );

      for (let idx = 0; idx < chunk.length; idx++) {
        const company = chunk[idx];
        const sub = subs[idx];

        rows.push({
          companyId: company.companyId.toString(),
          companyCode: company.companyCode,
          companyName: company.name,
          companyStatus: company.status,

          companySubscriptionId: sub?.companySubscriptionId?.toString() ?? null,
          planCode: sub?.plan?.planCode ?? null,
          planName: sub?.plan?.name ?? null,

          status: sub?.status ?? 'none',
          startDate: toDateOnly(sub?.startDate),
          endDate: toDateOnly(sub?.endDate),
        });
      }
    }

    return rows;
  }
}

