/**
 * ANA_MACHINERY_P_LTD only — Vendor Module Testing.docx model.
 * Scope: Ana_corporation_db company ANA_MACHINERY_P_LTD.
 * Does NOT change the global built-in registry (other companies unchanged).
 *
 * Actions:
 * - Form Configuration visibility overrides per the testing doc
 * - Custom fields for additional / renamed Ana-only fields
 * - Keep GSTIN custom field; hide built-in Federal Tax ID
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SCHEMA = 'Ana_corporation_db';
const COMPANY_CODE = 'ANA_MACHINERY_P_LTD';
const ENTITY = 'vendor';

/** Built-ins to hide for Ana (❌ / REMOVE / replaced by custom). */
const HIDE_FIELD_KEYS = [
  // Identity — may not require / remove
  'foreignName',
  'aliasName',
  'bpType',
  'industry',
  'federalTaxId',
  'taxId',
  'tax_id',

  // Contact — replaced by custom Name1/Mobile1/Landline/Name2/Mobile2; fax not required
  'phone',
  'mobile',
  'tel2',
  'fax',

  // Address — built-in Address block replaced by Address Line 1/2/3 + State + PIN
  'address',

  // Payment — interest on arrears not required
  'interestArrears',

  // Vendor's Bank details — exact doc set (hide extras / renamed Account)
  'bankCountry',
  'bankCode',
  'bankAccount',

  // Our Bank details — exact doc set
  'houseBankCountry',
  'houseBankAccount',

  // Not in Ana testing model (keep form config clean)
  'taxGroup',
  'withholdingTax',
  'notes',
  'internalNotes',
];

/**
 * Built-ins that must show (✅). Deletes any hide override so ERP default (visible) applies.
 * Locked identity fields are always visible.
 */
const KEEP_VISIBLE = [
  'vendorName',
  'supplierCode',
  'vendorCategory',
  'group',
  'currency',
  'isActive',

  'email',
  'website',
  'shippingType',
  'contactPerson',

  'city',
  'country',

  'paymentTerms',
  'paymentMethod',
  'priceList',
  'totalDiscount',
  'discountPercent',
  'creditLimit',
  'commitmentLimit',
  'effectiveDiscount',
  'dunningTerm',

  'bankName',
  'bankBranch',
  'bankSwift',
  'bankIban',
  'iban',
  'swift',

  'houseBank',
  'houseBankBranch',
  'houseBankIban',
  'houseBankSwift',
  'referenceDetails',
  'paymentBlock',
  'singlePayment',

  'consolidatingBp',
  'planningGroup',
  'accountsPayable',
  'downPaymentClearing',
  'downPaymentInterim',
  'affiliate',
  'glAccount',
  'reconciliationAccount',

  'remarks',
];

/** Ana-only custom fields (additional / rename stand-ins). */
const CUSTOM_FIELDS = [
  {
    fieldName: 'contactPersonName1',
    displayName: "Contact Person's Name 1",
    sectionKey: 'contact',
    fieldType: 'text',
    sortOrder: 90,
    helpText: 'Primary contact person',
  },
  {
    fieldName: 'mobile1',
    displayName: 'Mobile 1',
    sectionKey: 'contact',
    fieldType: 'phone',
    sortOrder: 91,
  },
  {
    fieldName: 'landlineTelephone',
    displayName: 'Landline Telephone',
    sectionKey: 'contact',
    fieldType: 'phone',
    sortOrder: 92,
    helpText: 'Replaces built-in Tel 1 for Ana Machinery',
  },
  {
    fieldName: 'contactPersonName2',
    displayName: "Contact Person's Name 2",
    sectionKey: 'contact',
    fieldType: 'text',
    sortOrder: 93,
  },
  {
    fieldName: 'mobile2',
    displayName: 'Mobile 2',
    sectionKey: 'contact',
    fieldType: 'phone',
    sortOrder: 94,
  },
  {
    fieldName: 'addressLine1',
    displayName: 'Address Line 1',
    sectionKey: 'address',
    fieldType: 'text',
    sortOrder: 200,
  },
  {
    fieldName: 'addressLine2',
    displayName: 'Address Line 2',
    sectionKey: 'address',
    fieldType: 'text',
    sortOrder: 201,
  },
  {
    fieldName: 'addressLine3',
    displayName: 'Address Line 3',
    sectionKey: 'address',
    fieldType: 'text',
    sortOrder: 202,
  },
  {
    fieldName: 'stateName',
    displayName: 'State name',
    sectionKey: 'address',
    fieldType: 'text',
    sortOrder: 221,
  },
  {
    fieldName: 'pinCode',
    displayName: 'PIN code',
    sectionKey: 'address',
    fieldType: 'text',
    sortOrder: 222,
    validation: { maxLength: 12 },
  },
  {
    fieldName: 'bankBeneficiaryName',
    displayName: 'Beneficiary Name',
    sectionKey: 'bank',
    fieldType: 'text',
    sortOrder: 400,
  },
  {
    fieldName: 'bankAccountNumber',
    displayName: 'Account number',
    sectionKey: 'bank',
    fieldType: 'text',
    sortOrder: 410,
    helpText: "Ana — replaces built-in Account label for Vendor's Bank details",
  },
  {
    fieldName: 'bankIfsc',
    displayName: 'IFSC code',
    sectionKey: 'bank',
    fieldType: 'text',
    sortOrder: 440,
    validation: { maxLength: 11 },
  },
  {
    fieldName: 'houseBankBeneficiaryName',
    displayName: 'Beneficiary Name',
    sectionKey: 'paymentRun',
    fieldType: 'text',
    sortOrder: 500,
  },
  {
    fieldName: 'houseBankAccountNumber',
    displayName: 'Account number',
    sectionKey: 'paymentRun',
    fieldType: 'text',
    sortOrder: 510,
    helpText: 'Ana — replaces built-in Account label for Our Bank details',
  },
  {
    fieldName: 'houseBankIfsc',
    displayName: 'IFSC code',
    sectionKey: 'paymentRun',
    fieldType: 'text',
    sortOrder: 540,
    validation: { maxLength: 11 },
  },
  {
    fieldName: 'gstin',
    displayName: 'GSTIN',
    sectionKey: 'general',
    fieldType: 'text',
    sortOrder: 35,
    isSearchable: true,
    isFilterable: true,
    placeholder: '22AAAAA0000A1Z5',
    helpText: 'Goods and Services Tax Identification Number (Ana — Federal Tax ID removed)',
    validation: {
      maxLength: 15,
      regex: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
    },
  },
];

function json(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

async function upsertCustomField(prisma, companyId, userId, def) {
  const existing = await prisma.customFieldDefinition.findFirst({
    where: {
      companyId,
      entityType: ENTITY,
      fieldName: def.fieldName,
      deletedAt: null,
    },
  });

  const data = {
    displayName: def.displayName,
    fieldType: def.fieldType,
    sectionKey: def.sectionKey,
    sortOrder: def.sortOrder,
    isRequired: false,
    isActive: true,
    isHidden: false,
    isSearchable: def.isSearchable ?? false,
    isFilterable: def.isFilterable ?? false,
    placeholder: def.placeholder ?? null,
    helpText: def.helpText ?? null,
    validation: def.validation ?? null,
  };

  if (existing) {
    await prisma.customFieldDefinition.update({
      where: { fieldId: existing.fieldId },
      data,
    });
    return { fieldName: def.fieldName, action: 'updated' };
  }

  await prisma.customFieldDefinition.create({
    data: {
      companyId,
      entityType: ENTITY,
      fieldName: def.fieldName,
      ...data,
      createdBy: userId,
    },
  });
  return { fieldName: def.fieldName, action: 'created' };
}

async function main() {
  if (String(process.env.GCP_SQL_SCHEMA) !== SCHEMA) {
    throw new Error(`GCP_SQL_SCHEMA must be ${SCHEMA} (got ${process.env.GCP_SQL_SCHEMA})`);
  }

  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findFirst({
      where: { companyCode: COMPANY_CODE, deletedAt: null },
    });
    if (!company) throw new Error(`${COMPANY_CODE} not found`);
    const companyId = company.companyId;

    const membership = await prisma.userCompany.findFirst({
      where: { companyId, deletedAt: null, isPrimaryAdmin: true },
      include: { user: true },
    });
    const actorId = membership?.userId ?? null;

    for (const fieldKey of HIDE_FIELD_KEYS) {
      await prisma.companyFieldConfiguration.upsert({
        where: {
          companyId_entityType_fieldKey: {
            companyId,
            entityType: ENTITY,
            fieldKey,
          },
        },
        update: { isVisible: false },
        create: {
          companyId,
          entityType: ENTITY,
          fieldKey,
          isVisible: false,
        },
      });
    }

    for (const fieldKey of KEEP_VISIBLE) {
      await prisma.companyFieldConfiguration.deleteMany({
        where: { companyId, entityType: ENTITY, fieldKey },
      });
    }

    const customResults = [];
    for (const def of CUSTOM_FIELDS) {
      customResults.push(await upsertCustomField(prisma, companyId, actorId, def));
    }

    // Deactivate any other vendor custom fields not in this Ana model
    const keepNames = CUSTOM_FIELDS.map((f) => f.fieldName);
    await prisma.customFieldDefinition.updateMany({
      where: {
        companyId,
        entityType: ENTITY,
        deletedAt: null,
        fieldName: { notIn: keepNames },
      },
      data: { isHidden: true, isActive: false },
    });

    // Deactivate legacy combined GSTIN/UIN custom field if present
    await prisma.customFieldDefinition.updateMany({
      where: {
        companyId,
        entityType: ENTITY,
        fieldName: 'gSTINUinFederalTaxId',
        deletedAt: null,
      },
      data: { isHidden: true, isActive: false },
    });

    const hidden = await prisma.companyFieldConfiguration.findMany({
      where: { companyId, entityType: ENTITY, isVisible: false },
      select: { fieldKey: true },
      orderBy: { fieldKey: 'asc' },
    });
    const customs = await prisma.customFieldDefinition.findMany({
      where: { companyId, entityType: ENTITY, deletedAt: null, isActive: true, isHidden: false },
      select: { fieldName: true, displayName: true, sectionKey: true, sortOrder: true },
      orderBy: [{ sectionKey: 'asc' }, { sortOrder: 'asc' }],
    });

    console.log(
      json({
        scope: 'ANA_MACHINERY_P_LTD only — Ana_corporation_db',
        source: 'Vendor Module Testing.docx',
        company: { companyId: String(companyId), companyCode: company.companyCode },
        hiddenBuiltIns: hidden.map((r) => r.fieldKey),
        customFieldActions: customResults,
        activeCustomFields: customs,
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
