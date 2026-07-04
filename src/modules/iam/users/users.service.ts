import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AssignUserRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const user = await this.repository.findById(id);
    if (!user) throw new NotFoundException('User');
    return serialize(user);
  }

  async create(companyId: string, dto: CreateUserDto, actorId: string) {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.repository.create(dto, companyId, passwordHash, actorId);

    await this.auditService.log({
      companyId,
      userId: user.userId.toString(),
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'User',
      entityId: user.userId.toString(),
    });

    return serialize(user);
  }

  async update(id: string, companyId: string, dto: UpdateUserDto, actorId: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('User');

    const user = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      userId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'User',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(user);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('User');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      userId: id,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'User',
      entityId: id,
    });

    return { message: 'User deleted' };
  }

  async assignRole(
    userId: string,
    companyId: string,
    dto: AssignUserRoleDto,
    actorId: string,
  ) {
    const user = await this.repository.findById(userId);
    if (!user) throw new NotFoundException('User');

    const assignment = await this.repository.assignRole(userId, companyId, dto.roleId, actorId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: assignment.userRoleId.toString(),
      newValue: { roleId: dto.roleId },
    });

    return serialize(assignment);
  }
}
