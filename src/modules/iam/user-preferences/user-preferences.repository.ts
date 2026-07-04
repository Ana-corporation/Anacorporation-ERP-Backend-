import { Injectable } from '@nestjs/common';
import { Prisma, Theme } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_PREFERENCES_LIST_FILTER: ListFilterOptions = {
  dateRange: { field: 'createdAt' },
  searchFields: ['language', 'homePage'],
  sortFields: ['createdAt', 'language', 'theme'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserPreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  assertUserInCompany(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
    });
  }

  findByUserAndCompany(userId: string, companyId: string | null) {
    return this.prisma.userPreference.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: companyId ? parseBigIntId(companyId) : null,
      },
      select: this.publicSelect(),
    });
  }

  async findManyByUser(userId: string, companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      {
        userId: parseBigIntId(userId),
        OR: [{ companyId: parseBigIntId(companyId) }, { companyId: null }],
      },
      query,
      USER_PREFERENCES_LIST_FILTER,
    ) as Prisma.UserPreferenceWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userPreference.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_PREFERENCES_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userPreference.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userPreference.findFirst({
      where: {
        preferenceId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId?: string | null;
    theme: Theme;
    accentColor?: string;
    language: string;
    dashboardLayout?: string;
    homePage?: string;
    menuStyle?: string;
    fontSize?: string;
    density?: string;
    dateFormat: string;
    timeFormat: string;
    numberFormat?: string;
    currencyFormat?: string;
    defaultPrinter?: string;
    defaultReportFormat?: string;
    defaultWarehouseId?: string | null;
    defaultBranchId?: string | null;
    defaultFinancialYear?: string;
    defaultScreen?: string;
    notificationPreference?: string;
  }) {
    return this.prisma.userPreference.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: data.companyId ? parseBigIntId(data.companyId) : null,
        theme: data.theme,
        accentColor: data.accentColor,
        language: data.language,
        dashboardLayout: data.dashboardLayout,
        homePage: data.homePage,
        menuStyle: data.menuStyle,
        fontSize: data.fontSize,
        density: data.density,
        dateFormat: data.dateFormat,
        timeFormat: data.timeFormat,
        numberFormat: data.numberFormat,
        currencyFormat: data.currencyFormat,
        defaultPrinter: data.defaultPrinter,
        defaultReportFormat: data.defaultReportFormat,
        defaultWarehouseId: data.defaultWarehouseId ? parseBigIntId(data.defaultWarehouseId) : null,
        defaultBranchId: data.defaultBranchId ? parseBigIntId(data.defaultBranchId) : null,
        defaultFinancialYear: data.defaultFinancialYear,
        defaultScreen: data.defaultScreen,
        notificationPreference: data.notificationPreference,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: Partial<{
      theme: Theme;
      accentColor: string | null;
      language: string;
      dashboardLayout: string | null;
      homePage: string | null;
      menuStyle: string | null;
      fontSize: string | null;
      density: string | null;
      dateFormat: string;
      timeFormat: string;
      numberFormat: string | null;
      currencyFormat: string | null;
      defaultPrinter: string | null;
      defaultReportFormat: string | null;
      defaultWarehouseId: string | null;
      defaultBranchId: string | null;
      defaultFinancialYear: string | null;
      defaultScreen: string | null;
      notificationPreference: string | null;
    }>,
  ) {
    return this.prisma.userPreference.update({
      where: { preferenceId: parseBigIntId(id) },
      data: {
        ...(data.theme !== undefined ? { theme: data.theme } : {}),
        ...(data.accentColor !== undefined ? { accentColor: data.accentColor } : {}),
        ...(data.language !== undefined ? { language: data.language } : {}),
        ...(data.dashboardLayout !== undefined ? { dashboardLayout: data.dashboardLayout } : {}),
        ...(data.homePage !== undefined ? { homePage: data.homePage } : {}),
        ...(data.menuStyle !== undefined ? { menuStyle: data.menuStyle } : {}),
        ...(data.fontSize !== undefined ? { fontSize: data.fontSize } : {}),
        ...(data.density !== undefined ? { density: data.density } : {}),
        ...(data.dateFormat !== undefined ? { dateFormat: data.dateFormat } : {}),
        ...(data.timeFormat !== undefined ? { timeFormat: data.timeFormat } : {}),
        ...(data.numberFormat !== undefined ? { numberFormat: data.numberFormat } : {}),
        ...(data.currencyFormat !== undefined ? { currencyFormat: data.currencyFormat } : {}),
        ...(data.defaultPrinter !== undefined ? { defaultPrinter: data.defaultPrinter } : {}),
        ...(data.defaultReportFormat !== undefined ? { defaultReportFormat: data.defaultReportFormat } : {}),
        ...(data.defaultWarehouseId !== undefined
          ? { defaultWarehouseId: data.defaultWarehouseId ? parseBigIntId(data.defaultWarehouseId) : null }
          : {}),
        ...(data.defaultBranchId !== undefined
          ? { defaultBranchId: data.defaultBranchId ? parseBigIntId(data.defaultBranchId) : null }
          : {}),
        ...(data.defaultFinancialYear !== undefined ? { defaultFinancialYear: data.defaultFinancialYear } : {}),
        ...(data.defaultScreen !== undefined ? { defaultScreen: data.defaultScreen } : {}),
        ...(data.notificationPreference !== undefined ? { notificationPreference: data.notificationPreference } : {}),
        updatedAt: new Date(),
        rowVersion: { increment: 1 },
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userPreference.delete({
      where: { preferenceId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      preferenceId: true,
      userId: true,
      companyId: true,
      theme: true,
      accentColor: true,
      language: true,
      dashboardLayout: true,
      homePage: true,
      menuStyle: true,
      fontSize: true,
      density: true,
      dateFormat: true,
      timeFormat: true,
      numberFormat: true,
      currencyFormat: true,
      defaultPrinter: true,
      defaultReportFormat: true,
      defaultWarehouseId: true,
      defaultBranchId: true,
      defaultFinancialYear: true,
      defaultScreen: true,
      notificationPreference: true,
      createdAt: true,
      updatedAt: true,
      rowVersion: true,
    } satisfies Prisma.UserPreferenceSelect;
  }
}
