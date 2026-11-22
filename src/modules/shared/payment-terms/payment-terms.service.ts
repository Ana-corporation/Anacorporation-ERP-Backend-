import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreatePaymentTermDto, UpdatePaymentTermDto } from './dto/payment-term.dto';

export const PAYMENT_TERM_ERROR_CODES = {
  NOT_FOUND: 'PAYMENT_TERM_NOT_FOUND',
  CODE_EXISTS: 'PAYMENT_TERM_CODE_EXISTS',
  IN_USE: 'PAYMENT_TERM_IN_USE',
} as const;

const paymentTermSelect = {
  paymentTermId: true,
  companyId: true,
  code: true,
  name: true,
  days: true,
  description: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedBy: true,
  updatedAt: true,
  rowVersion: true,
  _count: { select: { customers: { where: { deletedAt: null } } } },
} satisfies Prisma.PaymentTermSelect;

type PaymentTermRow = Prisma.PaymentTermGetPayload<{ select: typeof paymentTermSelect }>;

const notFound = () =>
  new BusinessException('Payment term not found', HttpStatus.NOT_FOUND, undefined, PAYMENT_TERM_ERROR_CODES.NOT_FOUND);

const codeExists = () =>
  new BusinessException(
    'A payment term with this code already exists',
    HttpStatus.CONFLICT,
    [{ field: 'code', message: 'Code already used' }],
    PAYMENT_TERM_ERROR_CODES.CODE_EXISTS,
  );

const isUniqueViolation = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
  (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23505'));

@Injectable()
export class PaymentTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** All non-deleted payment terms (active + inactive), by code. Small list, not paged. */
  async findAll(companyId: string) {
    const rows = await this.prisma.paymentTerm.findMany({
      where: { companyId: parseBigIntId(companyId, 'companyId'), deletedAt: null },
      select: paymentTermSelect,
      orderBy: { code: 'asc' },
    });
    const items = rows.map((r) => this.toRow(r));
    return toPaginatedResult(items, items.length, 1, Math.max(items.length, 1));
  }

  async findOne(id: string, companyId: string) {
    const row = await this.find(parseBigIntId(companyId, 'companyId'), parseBigIntId(id));
    if (!row) throw notFound();
    return this.toRow(row);
  }

  async create(companyId: string, dto: CreatePaymentTermDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const code = dto.code.trim().toUpperCase();
    let created;
    try {
      created = await this.prisma.paymentTerm.create({
        data: {
          companyId: company,
          code,
          name: dto.name.trim(),
          days: dto.days ?? 0,
          description: dto.description?.trim() || null,
          isActive: dto.isActive ?? true,
          createdBy: BigInt(actorId),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeExists();
      throw error;
    }
    await this.audit(companyId, actorId, UserAuditAction.create, created.paymentTermId, {
      code: created.code,
      name: created.name,
      days: created.days,
    });
    return this.findOne(created.paymentTermId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdatePaymentTermDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const paymentTermId = parseBigIntId(id);
    if (!(await this.find(company, paymentTermId))) throw notFound();
    const code = dto.code?.trim().toUpperCase();
    try {
      await this.prisma.paymentTerm.update({
        where: { paymentTermId },
        data: {
          ...(code !== undefined ? { code } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.days !== undefined ? { days: dto.days } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: BigInt(actorId),
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeExists();
      throw error;
    }
    await this.audit(companyId, actorId, UserAuditAction.update, paymentTermId, dto as Record<string, unknown>);
    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const paymentTermId = parseBigIntId(id);
    const row = await this.find(company, paymentTermId);
    if (!row) throw notFound();
    if (row._count.customers > 0) {
      throw new BusinessException(
        'This payment term is used by customers; deactivate it instead',
        HttpStatus.CONFLICT,
        undefined,
        PAYMENT_TERM_ERROR_CODES.IN_USE,
      );
    }
    await this.prisma.paymentTerm.update({
      where: { paymentTermId },
      data: { deletedAt: new Date(), deletedBy: BigInt(actorId), isActive: false },
    });
    await this.audit(companyId, actorId, UserAuditAction.delete, paymentTermId);
    return { message: 'Payment term deleted' };
  }

  private find(companyId: bigint, paymentTermId: bigint) {
    return this.prisma.paymentTerm.findFirst({
      where: { paymentTermId, companyId, deletedAt: null },
      select: paymentTermSelect,
    });
  }

  private toRow(row: PaymentTermRow) {
    const { _count, ...term } = row;
    return serialize({ ...term, customerCount: _count.customers }) as Record<string, unknown>;
  }

  private audit(
    companyId: string,
    actorId: string,
    action: UserAuditAction,
    id: bigint,
    newValue?: Record<string, unknown>,
  ) {
    return this.auditService.log({
      companyId,
      performedBy: actorId,
      action,
      entityName: 'PaymentTerm',
      entityId: id.toString(),
      newValue,
    });
  }
}
