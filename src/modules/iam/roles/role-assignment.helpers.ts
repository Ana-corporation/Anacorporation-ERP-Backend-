import { Prisma } from '@prisma/client';

export type RoleEndReason =
  | 'REASSIGNED'
  | 'UNASSIGNED'
  | 'ROLE_DEACTIVATED'
  | 'ROLE_DELETED';

/** End ACTIVE user_roles matching the scope (history-preserving). */
export async function endActiveUserRoles(
  // PrismaService $extends makes TransactionClient incompatible — accept any tx client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  scope: {
    companyId: bigint;
    userId?: bigint;
    roleId?: bigint;
    /** Exclude a specific userRoleId from ending */
    excludeUserRoleId?: bigint;
  },
  opts: { endedBy?: bigint; endReason: RoleEndReason },
) {
  const where: Prisma.UserRoleWhereInput = {
    companyId: scope.companyId,
    isActive: true,
    ...(scope.userId !== undefined ? { userId: scope.userId } : {}),
    ...(scope.roleId !== undefined ? { roleId: scope.roleId } : {}),
    ...(scope.excludeUserRoleId !== undefined
      ? { userRoleId: { not: scope.excludeUserRoleId } }
      : {}),
  };

  const rows = await tx.userRole.findMany({
    where,
    select: { userRoleId: true, userId: true },
  });

  if (rows.length === 0) return rows;

  await tx.userRole.updateMany({
    where: {
      userRoleId: { in: rows.map((r: { userRoleId: bigint }) => r.userRoleId) },
    },
    data: {
      isActive: false,
      endedAt: new Date(),
      endedBy: opts.endedBy,
      endReason: opts.endReason,
    },
  });

  return rows;
}

/**
 * Create a NEW active assignment period.
 * Ends any other ACTIVE roles for this user in the company first (one primary).
 */
export async function createActiveUserRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  data: {
    userId: bigint;
    companyId: bigint;
    roleId: bigint;
    assignedBy?: bigint;
  },
  endOthersReason: RoleEndReason = 'REASSIGNED',
) {
  await endActiveUserRoles(
    tx,
    { companyId: data.companyId, userId: data.userId },
    { endedBy: data.assignedBy, endReason: endOthersReason },
  );

  return tx.userRole.create({
    data: {
      userId: data.userId,
      companyId: data.companyId,
      roleId: data.roleId,
      assignedBy: data.assignedBy,
      assignedDate: new Date(),
      isActive: true,
      endedAt: null,
      endedBy: null,
      endReason: null,
    },
    include: {
      role: true,
      user: {
        select: {
          userId: true,
          displayName: true,
          firstName: true,
          lastName: true,
          email: true,
          username: true,
        },
      },
    },
  });
}
