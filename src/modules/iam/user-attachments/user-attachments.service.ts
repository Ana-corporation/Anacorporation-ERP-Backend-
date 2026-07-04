import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserAttachmentDto, UpdateUserAttachmentDto } from './dto/user-attachment.dto';
import { UserAttachmentsRepository } from './user-attachments.repository';

@Injectable()
export class UserAttachmentsService {
  constructor(
    private readonly repository: UserAttachmentsRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const attachment = await this.repository.findById(id, userId, companyId);
    if (!attachment) throw new NotFoundException('User attachment');
    return serialize(attachment);
  }

  async create(userId: string, companyId: string, dto: CreateUserAttachmentDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const record = await this.repository.create({
      userId,
      companyId,
      documentType: dto.documentType,
      fileName: dto.fileName,
      filePath: dto.filePath,
      fileSize: dto.fileSize !== undefined ? BigInt(dto.fileSize) : undefined,
      mimeType: dto.mimeType,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      uploadedBy: actorId,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserAttachment',
      entityId: record.attachmentId.toString(),
      newValue: { documentType: record.documentType, fileName: record.fileName },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserAttachmentDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User attachment');

    const record = await this.repository.update(id, {
      ...(dto.documentType !== undefined ? { documentType: dto.documentType } : {}),
      ...(dto.fileName !== undefined ? { fileName: dto.fileName } : {}),
      ...(dto.filePath !== undefined ? { filePath: dto.filePath } : {}),
      ...(dto.fileSize !== undefined
        ? { fileSize: dto.fileSize === null ? null : BigInt(dto.fileSize) }
        : {}),
      ...(dto.mimeType !== undefined ? { mimeType: dto.mimeType } : {}),
      ...(dto.expiryDate !== undefined
        ? { expiryDate: dto.expiryDate === null ? null : new Date(dto.expiryDate) }
        : {}),
      ...(dto.isVerified !== undefined ? { isVerified: dto.isVerified } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserAttachment',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User attachment');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserAttachment',
      entityId: id,
    });

    return { message: 'User attachment deleted' };
  }
}
