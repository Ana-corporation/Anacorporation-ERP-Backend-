import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const USERS_LIST_FILTER: ListFilterOptions = {
  contains: { email: 'email', name: 'username' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['email', 'username', 'firstName', 'lastName', 'displayName'],
  sortFields: ['email', 'username', 'firstName', 'lastName', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      {
        deletedAt: null,
        companies: { some: { companyId: parseBigIntId(companyId), deletedAt: null } },
      },
      query,
      USERS_LIST_FILTER,
    ) as Prisma.UserWhereInput;

    return this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USERS_LIST_FILTER),
      }),
      this.prisma.user.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.user.findFirst({
      where: { userId: parseBigIntId(id), deletedAt: null },
      include: {
        companies: { where: { deletedAt: null }, include: { company: true } },
        roles: { where: { isActive: true }, include: { role: true } },
      },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
  }

  findByUsername(username: string) {
    return this.prisma.user.findFirst({
      where: { username, deletedAt: null },
    });
  }

  findMembership(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  findCompanyRole(companyId: string, roleId: string) {
    return this.prisma.role.findFirst({
      where: {
        roleId: parseBigIntId(roleId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  /**
   * Company-scoped user snapshot for invite/list responses.
   */
  findCompanyUserDetail(userId: string, companyId: string) {
    return this.prisma.user.findFirst({
      where: {
        userId: parseBigIntId(userId),
        deletedAt: null,
        companies: {
          some: { companyId: parseBigIntId(companyId), deletedAt: null },
        },
      },
      include: {
        companies: {
          where: { companyId: parseBigIntId(companyId), deletedAt: null },
          take: 1,
        },
        roles: {
          where: {
            companyId: parseBigIntId(companyId),
            isActive: true,
          },
          include: { role: true },
          take: 1,
          orderBy: { assignedDate: 'desc' },
        },
      },
    });
  }

  create(dto: CreateUserDto, companyId: string, passwordHash: string, createdBy?: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username.trim(),
          email: dto.email.trim().toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          mobile: dto.mobile,
          displayName: [dto.firstName, dto.lastName].filter(Boolean).join(' ') || dto.username,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      await tx.userAuthentication.create({
        data: { userId: user.userId, passwordHash, mustChangePassword: true },
      });

      await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: parseBigIntId(companyId),
          status: 'active',
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      return user;
    });
  }

  createInvitedUser(params: {
    companyId: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    mobile?: string | null;
    employeeId?: string | null;
    passwordHash: string;
    passwordExpiresDate: Date;
    createdBy?: string;
  }) {
    const displayName =
      [params.firstName, params.lastName].filter(Boolean).join(' ').trim() || params.username;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: params.username,
          email: params.email.trim().toLowerCase(),
          firstName: params.firstName,
          lastName: params.lastName || null,
          mobile: params.mobile || null,
          displayName,
          createdBy: params.createdBy ? parseBigIntId(params.createdBy) : undefined,
        },
      });

      await tx.userAuthentication.create({
        data: {
          userId: user.userId,
          passwordHash: params.passwordHash,
          mustChangePassword: true,
          passwordExpiresDate: params.passwordExpiresDate,
          lastPasswordReset: new Date(),
        },
      });

      // active so temp password can be used for first login (mustChangePassword=true)
      const membership = await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: parseBigIntId(params.companyId),
          employeeId: params.employeeId || null,
          status: 'active',
          isDefault: true,
          createdBy: params.createdBy ? parseBigIntId(params.createdBy) : undefined,
        },
      });

      return { user, membership };
    });
  }

  attachMembership(params: {
    userId: string;
    companyId: string;
    employeeId?: string | null;
    createdBy?: string;
  }) {
    return this.prisma.userCompany.create({
      data: {
        userId: parseBigIntId(params.userId),
        companyId: parseBigIntId(params.companyId),
        employeeId: params.employeeId || null,
        status: 'active',
        isDefault: false,
        createdBy: params.createdBy ? parseBigIntId(params.createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateUserDto, updatedBy?: string) {
    return this.prisma.user.update({
      where: { userId: parseBigIntId(id) },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
        ...(dto.timeZone !== undefined ? { timeZone: dto.timeZone } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.user.update({
      where: { userId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }

  assignRole(userId: string, companyId: string, roleId: string, assignedBy?: string) {
    return this.prisma.userRole.upsert({
      where: {
        userId_companyId_roleId: {
          userId: parseBigIntId(userId),
          companyId: parseBigIntId(companyId),
          roleId: parseBigIntId(roleId),
        },
      },
      update: { isActive: true },
      create: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        assignedBy: assignedBy ? parseBigIntId(assignedBy) : undefined,
      },
      include: { role: true },
    });
  }
}
