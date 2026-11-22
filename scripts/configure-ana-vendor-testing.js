/**
 * ANA_MACHINERY_P_LTD only:
 * - Company admin login ANA02 / Jegan@123
 * - Hide UIN/Federal ID (taxId) and other non-required Vendor extras via form configuration
 * - Add GSTIN as a Vendor custom field on the General tab
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const SCHEMA = 'Ana_corporation_db';
const COMPANY_CODE = 'ANA_MACHINERY_P_LTD';
const EMPLOYEE_CODE = 'ANA02';
const PASSWORD = 'Jegan@123';
const ADMIN_EMAIL = 'jegan@anamachinery.com';

const HIDE_FIELD_KEYS = [
  'taxId',
  'foreignName',
  'aliasName',
  'group',
  'currency',
  'bpType',
  'industry',
  'tel2',
  'fax',
  'website',
  'shippingType',
  'creditLimit',
  'discountPercent',
  'priceList',
  'paymentBlock',
  'taxGroup',
  'withholdingTax',
  'singlePayment',
  'affiliate',
  'iban',
  'swift',
  'houseBank',
  'glAccount',
  'reconciliationAccount',
  'remarks',
  'notes',
  'internalNotes',
];

const KEEP_VISIBLE = [
  'vendorName',
  'supplierCode',
  'vendorCategory',
  'isActive',
  'email',
  'phone',
  'mobile',
  'contactPerson',
  'address',
  'city',
  'country',
  'paymentTerms',
  'paymentMethod',
  'bankName',
  'bankAccount',
  'bankBranch',
];

function json(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

async function main() {
  if (String(process.env.GCP_SQL_SCHEMA) !== SCHEMA) {
    throw new Error(`GCP_SQL_SCHEMA must be ${SCHEMA}`);
  }

  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findFirst({
      where: { companyCode: COMPANY_CODE, deletedAt: null },
    });
    if (!company) throw new Error(`${COMPANY_CODE} not found`);
    const companyId = company.companyId;

    let membership = await prisma.userCompany.findFirst({
      where: { companyId, employeeId: EMPLOYEE_CODE, deletedAt: null },
      include: { user: { include: { authentication: true } } },
    });

    if (!membership) {
      membership = await prisma.userCompany.findFirst({
        where: { companyId, user: { email: ADMIN_EMAIL, deletedAt: null }, deletedAt: null },
        include: { user: { include: { authentication: true } } },
      });
    }

    if (!membership) throw new Error(`No company admin user found for ${COMPANY_CODE}`);

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await prisma.$transaction(async (tx) => {
      await tx.userCompany.update({
        where: { userCompanyId: membership.userCompanyId },
        data: {
          employeeId: EMPLOYEE_CODE,
          status: 'active',
          isDefault: true,
          isPrimaryAdmin: true,
        },
      });

      await tx.user.update({
        where: { userId: membership.userId },
        data: { isActive: true, isLocked: false },
      });

      if (membership.user.authentication) {
        await tx.userAuthentication.update({
          where: { userId: membership.userId },
          data: {
            passwordHash,
            mustChangePassword: false,
            failedLoginCount: 0,
            accountLockedUntil: null,
          },
        });
      } else {
        await tx.userAuthentication.create({
          data: { userId: membership.userId, passwordHash, isEmailVerified: true },
        });
      }

      let adminRole = await tx.role.findFirst({
        where: {
          companyId,
          deletedAt: null,
          OR: [{ roleCode: 'ADMIN' }, { systemTemplateKey: 'ADMIN' }],
        },
      });
      if (!adminRole) {
        adminRole = await tx.role.create({
          data: {
            companyId,
            roleCode: 'ADMIN',
            roleName: 'Administrator',
            isSystem: true,
            roleType: 'SYSTEM',
            systemTemplateKey: 'ADMIN',
            createdBy: membership.userId,
          },
        });
      }

      const existingAssignment = await tx.userRole.findFirst({
        where: { userId: membership.userId, companyId, roleId: adminRole.roleId, isActive: true },
      });
      if (!existingAssignment) {
        await tx.userRole.create({
          data: {
            userId: membership.userId,
            companyId,
            roleId: adminRole.roleId,
            assignedBy: membership.userId,
            isActive: true,
          },
        });
      }

      const neededCodes = [
        'form_configurations:view',
        'form_configurations:edit',
        'custom_fields:view',
        'custom_fields:create',
        'custom_fields:edit',
        'custom_fields:delete',
        'vendors:view',
        'vendors:create',
        'vendors:edit',
        'vendors:delete',
      ];
      const permissions = await tx.permission.findMany({
        where: { permissionCode: { in: neededCodes } },
      });
      for (const permission of permissions) {
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: adminRole.roleId,
              permissionId: permission.permissionId,
            },
          },
          update: { isAllowed: true },
          create: {
            roleId: adminRole.roleId,
            moduleId: permission.moduleId,
            permissionId: permission.permissionId,
            isAllowed: true,
            createdBy: membership.userId,
          },
        });
      }
    });

    for (const fieldKey of HIDE_FIELD_KEYS) {
      await prisma.companyFieldConfiguration.upsert({
        where: {
          companyId_entityType_fieldKey: {
            companyId,
            entityType: 'vendor',
            fieldKey,
          },
        },
        update: { isVisible: false },
        create: {
          companyId,
          entityType: 'vendor',
          fieldKey,
          isVisible: false,
        },
      });
    }

    for (const fieldKey of KEEP_VISIBLE) {
      await prisma.companyFieldConfiguration.deleteMany({
        where: { companyId, entityType: 'vendor', fieldKey },
      });
    }

    const gstin = await prisma.customFieldDefinition.findFirst({
      where: {
        companyId,
        entityType: 'vendor',
        fieldName: 'gstin',
        deletedAt: null,
      },
    });
    if (!gstin) {
      await prisma.customFieldDefinition.create({
        data: {
          companyId,
          entityType: 'vendor',
          fieldName: 'gstin',
          displayName: 'GSTIN',
          fieldType: 'text',
          sectionKey: 'general',
          isRequired: false,
          sortOrder: 35,
          isActive: true,
          isSearchable: true,
          isFilterable: true,
          placeholder: '22AAAAA0000A1Z5',
          helpText: 'Goods and Services Tax Identification Number',
          validation: {
            maxLength: 15,
            regex: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
          },
          createdBy: membership.userId,
        },
      });
    }

    await prisma.customFieldDefinition.updateMany({
      where: {
        companyId,
        entityType: 'vendor',
        fieldName: 'gSTINUinFederalTaxId',
        deletedAt: null,
      },
      data: { isHidden: true, isActive: false },
    });

    const hidden = await prisma.companyFieldConfiguration.findMany({
      where: { companyId, entityType: 'vendor', isVisible: false },
      select: { fieldKey: true },
      orderBy: { fieldKey: 'asc' },
    });
    const fields = await prisma.customFieldDefinition.findMany({
      where: { companyId, entityType: 'vendor', deletedAt: null },
      select: { fieldName: true, displayName: true, sectionKey: true },
    });

    console.log(
      json({
        company: { companyId, companyCode: company.companyCode },
        login: {
          companyCode: COMPANY_CODE,
          employeeCode: EMPLOYEE_CODE,
          email: membership.user.email,
        },
        hiddenVendorFields: hidden.map((r) => r.fieldKey),
        customFields: fields,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
