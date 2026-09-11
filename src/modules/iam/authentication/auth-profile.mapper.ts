import {
  CompanyAccessMembershipSummary,
  CompanyAccessUserSummary,
} from './interfaces/company-access-context.interface';

export type ProfileUserSource = {
  userId: bigint | number | string;
  username: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  mobile?: string | null;
  profilePhoto?: string | null;
};

export type ProfileMembershipSource = {
  employeeId?: string | null;
  status?: string | null;
  departmentId?: bigint | number | string | null;
  designationId?: bigint | number | string | null;
  warehouseId?: bigint | number | string | null;
  department?: { name: string } | null;
  designation?: { name: string } | null;
  warehouse?: { name: string } | null;
};

function idOrNull(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveDisplayName(user: ProfileUserSource): string {
  return (
    user.displayName?.trim() ||
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    user.username
  );
}

export function membershipStatusForFe(status: string | null | undefined): 'ACTIVE' | 'INACTIVE' {
  return status === 'active' ? 'ACTIVE' : 'INACTIVE';
}

export function mapLoginUserProfile(
  user: ProfileUserSource,
  membership?: ProfileMembershipSource | null,
): CompanyAccessUserSummary {
  return {
    userId: String(user.userId),
    username: user.username,
    displayName: resolveDisplayName(user),
    email: user.email,
    phone: textOrNull(user.mobile),
    avatarUrl: textOrNull(user.profilePhoto),
    employeeCode: textOrNull(membership?.employeeId),
  };
}

export function mapLoginMembership(
  membership?: ProfileMembershipSource | null,
): CompanyAccessMembershipSummary | null {
  if (!membership) return null;
  return {
    departmentId: idOrNull(membership.departmentId),
    departmentName: textOrNull(membership.department?.name),
    designationId: idOrNull(membership.designationId),
    designationName: textOrNull(membership.designation?.name),
    warehouseId: idOrNull(membership.warehouseId),
    warehouseName: textOrNull(membership.warehouse?.name),
    status: membershipStatusForFe(membership.status),
  };
}
