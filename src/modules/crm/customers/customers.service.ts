import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import { GstinService } from '@/modules/shared/gstin/gstin.service';
import {
  CreateCustomerDto,
  CustomerAddressInput,
  CustomerContactInput,
  CustomerTaxIdentifierInput,
  RegistrationLookupQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { CustomerListRow, CustomersRepository, detailInclude } from './customers.repository';

export const CUSTOMER_ERROR_CODES = {
  NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CODE_EXISTS: 'CUSTOMER_CODE_EXISTS',
  TAX_ID_EXISTS: 'CUSTOMER_TAX_ID_EXISTS',
  CONFLICT: 'CUSTOMER_CONFLICT',
  REGISTRATION_LOOKUP_UNSUPPORTED: 'REGISTRATION_LOOKUP_UNSUPPORTED',
} as const;

const notFound = () => new NotFoundException('Customer');

const codeExists = () =>
  new BusinessException(
    'A customer with this code already exists',
    HttpStatus.CONFLICT,
    [{ field: 'customerCode', message: 'Code already used' }],
    CUSTOMER_ERROR_CODES.CODE_EXISTS,
  );

const conflict = () =>
  new BusinessException(
    'Someone else saved this customer. Reload and try again.',
    HttpStatus.CONFLICT,
    undefined,
    CUSTOMER_ERROR_CODES.CONFLICT,
  );

function mapUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
    if (/customer_code/.test(target)) throw codeExists();
    if (/id_type|id_value/.test(target)) {
      throw new BusinessException(
        'This tax identifier is already saved on the customer',
        HttpStatus.CONFLICT,
        [{ field: 'taxIdentifiers', message: 'Duplicate tax identifier' }],
        CUSTOMER_ERROR_CODES.TAX_ID_EXISTS,
      );
    }
    throw codeExists();
  }
  throw error as Error;
}

/** Exactly one primary/default row: keep the first flagged one, else flag the first row. */
function normalizeSingleFlag<T extends Record<string, unknown>>(rows: T[], flag: keyof T): T[] {
  const firstFlagged = rows.findIndex((r) => r[flag] === true);
  const winner = firstFlagged >= 0 ? firstFlagged : 0;
  return rows.map((row, i) => ({ ...row, [flag]: i === winner }));
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly auditService: AuditService,
    private readonly documentNumbers: DocumentNumberService,
    private readonly gstinService: GstinService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize({
      items: items.map((row) => this.toListRow(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  async lookup(companyId: string, search: string | undefined, limit: number) {
    const rows = await this.repository.lookup(companyId, search, limit);
    return serialize({ items: rows.map((row) => this.toListRow(row)) });
  }

  async findOne(id: string, companyId: string) {
    const row = await this.repository.findById(id, companyId);
    if (!row) throw notFound();
    return this.auditService.withAudit(serialize(row) as Record<string, unknown>);
  }

  async create(companyId: string, dto: CreateCustomerDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const actor = parseBigIntId(actorId, 'actorId');

    let createdId: bigint;
    try {
      createdId = await this.repository.transaction(async (tx) => {
        const manualCode = dto.customerCode?.trim().toUpperCase();
        const customerCode = manualCode || (await this.documentNumbers.reserve(tx, company, 'CUSTOMER'));

        const companyRow = await tx.company.findUniqueOrThrow({
          where: { companyId: company },
          select: { defaultCurrencyId: true },
        });

        const created = await tx.customer.create({
          data: {
            companyId: company,
            customerCode,
            name: dto.name.trim(),
            legalName: dto.legalName?.trim() || null,
            customerType: dto.customerType ?? 'BUSINESS',
            email: dto.email?.trim() || null,
            phone: dto.phone?.trim() || null,
            website: dto.website?.trim() || null,
            currencyId: dto.currencyId ? BigInt(dto.currencyId) : companyRow.defaultCurrencyId,
            paymentTermId: dto.paymentTermId ? BigInt(dto.paymentTermId) : null,
            creditLimit: dto.creditLimit ?? null,
            salespersonUserId: dto.salespersonUserId ? BigInt(dto.salespersonUserId) : null,
            notes: dto.notes?.trim() || null,
            isActive: dto.isActive ?? true,
            metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            createdBy: actor,
          },
        });

        await this.replaceChildren(tx, company, created.customerId, actor, {
          taxIdentifiers: dto.taxIdentifiers,
          addresses: dto.addresses,
          contacts: dto.contacts,
        });

        return created.customerId;
      });
    } catch (error) {
      mapUniqueViolation(error);
    }

    await this.audit(companyId, actorId, 'create', createdId!, { name: dto.name });
    return this.findOne(createdId!.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateCustomerDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const customerId = parseBigIntId(id);
    const actor = parseBigIntId(actorId, 'actorId');

    try {
      await this.repository.transaction(async (tx) => {
        const current = await tx.customer.findFirst({
          where: { customerId, companyId: company, deletedAt: null },
          select: { customerId: true, rowVersion: true },
        });
        if (!current) throw notFound();
        if (dto.rowVersion !== undefined && dto.rowVersion !== current.rowVersion) throw conflict();

        const { count } = await tx.customer.updateMany({
          where: { customerId, rowVersion: current.rowVersion },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.legalName !== undefined ? { legalName: dto.legalName?.trim() || null } : {}),
            ...(dto.customerType !== undefined ? { customerType: dto.customerType } : {}),
            ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
            ...(dto.website !== undefined ? { website: dto.website?.trim() || null } : {}),
            ...(dto.currencyId !== undefined
              ? { currencyId: dto.currencyId ? BigInt(dto.currencyId) : null }
              : {}),
            ...(dto.paymentTermId !== undefined
              ? { paymentTermId: dto.paymentTermId ? BigInt(dto.paymentTermId) : null }
              : {}),
            ...(dto.creditLimit !== undefined ? { creditLimit: dto.creditLimit } : {}),
            ...(dto.salespersonUserId !== undefined
              ? { salespersonUserId: dto.salespersonUserId ? BigInt(dto.salespersonUserId) : null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
            updatedBy: actor,
            updatedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        if (count === 0) throw conflict();

        await this.replaceChildren(tx, company, customerId, actor, {
          taxIdentifiers: dto.taxIdentifiers,
          addresses: dto.addresses,
          contacts: dto.contacts,
        });
      });
    } catch (error) {
      mapUniqueViolation(error);
    }

    await this.audit(companyId, actorId, 'update', customerId, dto as Record<string, unknown>);
    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const customerId = parseBigIntId(id);
    const row = await this.repository.prisma.customer.findFirst({
      where: { customerId, companyId: parseBigIntId(companyId, 'companyId'), deletedAt: null },
      select: { customerId: true },
    });
    if (!row) throw notFound();
    await this.repository.prisma.customer.update({
      where: { customerId },
      data: { deletedAt: new Date(), deletedBy: parseBigIntId(actorId, 'actorId'), isActive: false },
    });
    await this.audit(companyId, actorId, 'delete', customerId);
    return { message: 'Customer deleted' };
  }

  /**
   * Prefill a new customer from an official registry. GSTIN today (gstinapi.in);
   * other id types return 422 until a provider is wired.
   */
  async registrationLookup(companyId: string, query: RegistrationLookupQueryDto) {
    if (query.idType !== 'GSTIN') {
      throw new BusinessException(
        `No registration lookup is available for ${query.idType} yet.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field: 'idType', message: 'Lookup not available' }],
        CUSTOMER_ERROR_CODES.REGISTRATION_LOOKUP_UNSUPPORTED,
      );
    }

    const result = await this.gstinService.verifyForCompany(companyId, {
      gstin: query.idValue,
      includeProfile: true,
    });
    const s = result.suggestedFields;
    const gstin = result.gstin;
    const taxIdentifiers: Array<Record<string, unknown>> = [
      { idType: 'GSTIN', idValue: gstin, regionCode: gstin.slice(0, 2), isPrimary: true },
    ];
    if (gstin.length === 15) {
      taxIdentifiers.push({ idType: 'PAN', idValue: gstin.slice(2, 12), isPrimary: false });
    }
    return {
      idType: 'GSTIN',
      idValue: gstin,
      verified: result.verified,
      prefill: {
        name: s.tradeName || s.legalName || null,
        legalName: s.legalName ?? null,
        customerType: 'BUSINESS',
        taxIdentifiers,
        addresses: s.address
          ? [
              {
                addressType: 'BILL_TO',
                line1: s.address,
                city: s.city ?? null,
                region: s.state ?? null,
                postalCode: s.pincode ?? null,
                countryCode: 'IN',
                isDefault: true,
              },
            ]
          : [],
      },
      raw: result.raw,
    };
  }

  /** Delete + recreate the child sets that were sent (undefined = leave unchanged). */
  private async replaceChildren(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    customerId: bigint,
    actor: bigint,
    children: {
      taxIdentifiers?: CustomerTaxIdentifierInput[];
      addresses?: CustomerAddressInput[];
      contacts?: CustomerContactInput[];
    },
  ) {
    if (children.taxIdentifiers !== undefined) {
      await tx.customerTaxIdentifier.deleteMany({ where: { customerId } });
      const rows = normalizeSingleFlag(children.taxIdentifiers, 'isPrimary');
      if (rows.length > 0) {
        await tx.customerTaxIdentifier.createMany({
          data: rows.map((row) => ({
            customerId,
            companyId,
            idType: row.idType,
            idLabel: row.idLabel?.trim() || null,
            idValue: row.idValue.trim().toUpperCase(),
            regionCode: row.regionCode?.trim() || null,
            isPrimary: row.isPrimary === true,
            isActive: row.isActive ?? true,
            createdBy: actor,
          })),
        });
      }
    }

    if (children.addresses !== undefined) {
      await tx.customerAddress.deleteMany({ where: { customerId } });
      const rows = normalizeSingleFlag(children.addresses, 'isDefault');
      if (rows.length > 0) {
        await tx.customerAddress.createMany({
          data: rows.map((row) => ({
            customerId,
            companyId,
            addressType: row.addressType ?? 'BILL_TO',
            label: row.label?.trim() || null,
            line1: row.line1.trim(),
            line2: row.line2?.trim() || null,
            city: row.city?.trim() || null,
            region: row.region?.trim() || null,
            regionCode: row.regionCode?.trim() || null,
            postalCode: row.postalCode?.trim() || null,
            countryCode: row.countryCode ?? null,
            isDefault: row.isDefault === true,
            isActive: row.isActive ?? true,
            createdBy: actor,
          })),
        });
      }
    }

    if (children.contacts !== undefined) {
      await tx.customerContact.deleteMany({ where: { customerId } });
      const rows = normalizeSingleFlag(children.contacts, 'isPrimary');
      if (rows.length > 0) {
        await tx.customerContact.createMany({
          data: rows.map((row) => ({
            customerId,
            companyId,
            name: row.name.trim(),
            designation: row.designation?.trim() || null,
            email: row.email?.trim() || null,
            phone: row.phone?.trim() || null,
            isPrimary: row.isPrimary === true,
            isActive: row.isActive ?? true,
            createdBy: actor,
          })),
        });
      }
    }
  }

  private toListRow(row: CustomerListRow) {
    const { taxIdentifiers, addresses, ...customer } = row;
    const primaryTax = taxIdentifiers[0] ?? null;
    const primaryAddress = addresses[0] ?? null;
    return {
      ...customer,
      primaryTaxType: primaryTax?.idType ?? null,
      primaryTaxLabel: primaryTax?.idLabel ?? null,
      primaryTaxId: primaryTax?.idValue ?? null,
      primaryCity: primaryAddress?.city ?? null,
      primaryRegion: primaryAddress?.region ?? null,
      primaryCountryCode: primaryAddress?.countryCode ?? null,
    };
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
      entityName: 'Customer',
      entityId: id.toString(),
      newValue,
    });
  }
}

/** Re-export so the controller can type detail responses if needed. */
export { detailInclude };
