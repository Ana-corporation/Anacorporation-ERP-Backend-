import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserPreferenceDto, UpdateUserPreferenceDto } from './dto/user-preference.dto';
import { UserPreferencesRepository } from './user-preferences.repository';

@Injectable()
export class UserPreferencesService {
  constructor(
    private readonly repository: UserPreferencesRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  private resolveCompanyId(dtoCompanyId: string | null | undefined, headerCompanyId: string) {
    if (dtoCompanyId === null) return null;
    if (dtoCompanyId !== undefined) return dtoCompanyId;
    return headerCompanyId;
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findById(id, userId);
    if (!record) throw new NotFoundException('User preference');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserPreferenceDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const scopedCompanyId = this.resolveCompanyId(dto.companyId, companyId);
    const existing = await this.repository.findByUserAndCompany(userId, scopedCompanyId);
    if (existing) throw new ConflictException('User preference already exists for this scope');

    const record = await this.repository.create({
      userId,
      companyId: scopedCompanyId,
      theme: dto.theme ?? 'light',
      accentColor: dto.accentColor,
      language: dto.language ?? 'en',
      dashboardLayout: dto.dashboardLayout,
      homePage: dto.homePage,
      menuStyle: dto.menuStyle,
      fontSize: dto.fontSize,
      density: dto.density,
      dateFormat: dto.dateFormat ?? 'yyyy-MM-dd',
      timeFormat: dto.timeFormat ?? 'HH:mm',
      numberFormat: dto.numberFormat,
      currencyFormat: dto.currencyFormat,
      defaultPrinter: dto.defaultPrinter,
      defaultReportFormat: dto.defaultReportFormat,
      defaultWarehouseId: dto.defaultWarehouseId,
      defaultBranchId: dto.defaultBranchId,
      defaultFinancialYear: dto.defaultFinancialYear,
      defaultScreen: dto.defaultScreen,
      notificationPreference: dto.notificationPreference,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserPreference',
      entityId: record.preferenceId.toString(),
      newValue: { theme: record.theme, language: record.language },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserPreferenceDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User preference');

    const record = await this.repository.update(id, {
      ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
      ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor } : {}),
      ...(dto.language !== undefined ? { language: dto.language } : {}),
      ...(dto.dashboardLayout !== undefined ? { dashboardLayout: dto.dashboardLayout } : {}),
      ...(dto.homePage !== undefined ? { homePage: dto.homePage } : {}),
      ...(dto.menuStyle !== undefined ? { menuStyle: dto.menuStyle } : {}),
      ...(dto.fontSize !== undefined ? { fontSize: dto.fontSize } : {}),
      ...(dto.density !== undefined ? { density: dto.density } : {}),
      ...(dto.dateFormat !== undefined ? { dateFormat: dto.dateFormat } : {}),
      ...(dto.timeFormat !== undefined ? { timeFormat: dto.timeFormat } : {}),
      ...(dto.numberFormat !== undefined ? { numberFormat: dto.numberFormat } : {}),
      ...(dto.currencyFormat !== undefined ? { currencyFormat: dto.currencyFormat } : {}),
      ...(dto.defaultPrinter !== undefined ? { defaultPrinter: dto.defaultPrinter } : {}),
      ...(dto.defaultReportFormat !== undefined ? { defaultReportFormat: dto.defaultReportFormat } : {}),
      ...(dto.defaultWarehouseId !== undefined ? { defaultWarehouseId: dto.defaultWarehouseId } : {}),
      ...(dto.defaultBranchId !== undefined ? { defaultBranchId: dto.defaultBranchId } : {}),
      ...(dto.defaultFinancialYear !== undefined ? { defaultFinancialYear: dto.defaultFinancialYear } : {}),
      ...(dto.defaultScreen !== undefined ? { defaultScreen: dto.defaultScreen } : {}),
      ...(dto.notificationPreference !== undefined ? { notificationPreference: dto.notificationPreference } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserPreference',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User preference');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserPreference',
      entityId: id,
    });

    return { message: 'User preference deleted' };
  }
}
