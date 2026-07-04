import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateSuperAdminDto, UpdateSuperAdminDto } from './dto/super-admin.dto';

const SUPER_ADMINS_LIST_FILTER: ListFilterOptions = {
  contains: { name: 'name', email: 'email' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['name', 'email'],
  sortFields: ['name', 'email', 'createdAt', 'lastLoginAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class SuperAdminsRepository {
  constructor(private readonly prisma: PrismaService) {}

  countActive() {
    return this.prisma.superAdmin.count({ where: { deletedAt: null } });
  }

  findMany(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({ deletedAt: null }, query, SUPER_ADMINS_LIST_FILTER) as Prisma.SuperAdminWhereInput;

    return this.prisma.$transaction([
      this.prisma.superAdmin.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, SUPER_ADMINS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.superAdmin.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.superAdmin.findFirst({
      where: { superAdminId: parseBigIntId(id), deletedAt: null },
      select: this.publicSelect(),
    });
  }

  findByEmail(email: string) {
    return this.prisma.superAdmin.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
  }

  findByEmailWithPassword(email: string) {
    return this.prisma.superAdmin.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null, isActive: true },
    });
  }

  create(dto: CreateSuperAdminDto, passwordHash: string, createdBy?: string) {
    return this.prisma.superAdmin.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        passwordHash,
        isMfaEnabled: dto.isMfaEnabled ?? false,
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
      select: this.publicSelect(),
    });
  }

  update(id: string, data: Prisma.SuperAdminUpdateInput) {
    return this.prisma.superAdmin.update({
      where: { superAdminId: parseBigIntId(id) },
      data,
      select: this.publicSelect(),
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.superAdmin.update({
      where: { superAdminId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
      select: this.publicSelect(),
    });
  }

  updateLastLogin(id: string) {
    return this.prisma.superAdmin.update({
      where: { superAdminId: parseBigIntId(id) },
      data: { lastLoginAt: new Date() },
    });
  }

  private publicSelect() {
    return {
      superAdminId: true,
      name: true,
      email: true,
      isMfaEnabled: true,
      isActive: true,
      lastLoginAt: true,
      createdBy: true,
      createdAt: true,
      updatedBy: true,
      updatedAt: true,
      rowVersion: true,
    } satisfies Prisma.SuperAdminSelect;
  }
}
