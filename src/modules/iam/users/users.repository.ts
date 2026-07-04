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
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
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
