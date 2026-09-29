import { HttpStatus } from '@nestjs/common';
import { VendorFormInvitationStatus } from '@prisma/client';
import { hashVendorFormToken } from './vendor-form-token.util';
import { VendorFormInvitationService } from './vendor-form-invitation.service';

const COMPANY = {
  companyId: 28n,
  name: 'Ana Machinery (P) Ltd',
  legalName: null,
  email: 'info@anamachinery.com',
  phone: '+91 96262 59191',
  logoUrl: '/assets/logo/ana-logo.jpeg',
};

const TOKEN = 'a'.repeat(64);

function draftVendor(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 501n,
    companyId: 28n,
    vendorCode: 'DR001',
    supplierType: null,
    name: 'new.vendor@example.com',
    email: 'new.vendor@example.com',
    phone: null,
    address: null,
    city: null,
    country: null,
    taxId: null,
    isActive: false,
    metadata: null,
    deletedAt: null,
    ...overrides,
  };
}

function customDef(overrides: Record<string, unknown> = {}) {
  return {
    fieldId: 71n,
    companyId: 28n,
    entityType: 'vendor',
    fieldName: 'gstin',
    displayName: 'GSTIN',
    fieldType: 'text',
    sectionKey: 'general',
    isRequired: false,
    defaultValue: null,
    validation: null,
    options: null,
    placeholder: null,
    helpText: null,
    sortOrder: 5,
    isActive: true,
    isReadOnly: false,
    isHidden: false,
    isRegistrationVisible: true,
    deletedAt: null,
    ...overrides,
  };
}

type SetupOptions = {
  visibility?: Map<string, boolean>;
  registration?: Map<string, boolean>;
  customDefs?: ReturnType<typeof customDef>[];
  customValues?: Record<string, unknown>;
  registrationHiddenSections?: string[];
  lockedVendorMetadata?: unknown;
};

function setup(options: SetupOptions = {}) {
  const tx = {
    vendor: {
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn(async () => ({ metadata: options.lockedVendorMetadata ?? null })),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  let assetSeq = 0;
  const storageService = {
    uploadFile: jest.fn(async (input: { originalName: string; mimeType: string; buffer: Buffer }) => ({
      id: `asset-${++assetSeq}`,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      storageKey: `28/secret-${assetSeq}`,
      createdAt: new Date('2026-09-29T10:00:00Z'),
    })),
    deleteFile: jest.fn().mockResolvedValue({}),
    resolveReadableUrl: jest.fn(async (url: string) =>
      url.startsWith('https://storage.googleapis.com/erp-files/') ? `${url}?X-Goog-Signature=abc` : url,
    ),
  };
  const repository = {
    findOpenByRecipientEmail: jest.fn().mockResolvedValue(null),
    findActiveIdsForVendor: jest.fn().mockResolvedValue([]),
    cancelActiveForVendor: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockResolvedValue({ id: 900n }),
    markSent: jest.fn().mockResolvedValue({}),
    markSendFailed: jest.fn().mockResolvedValue({}),
    markSubmitted: jest.fn().mockResolvedValue({}),
    markExpired: jest.fn().mockResolvedValue({}),
    findByTokenHash: jest.fn(),
  };
  const vendorsRepository = {
    nextVendorCode: jest.fn(async (_companyId: string, prefix: string) => `${prefix}001`),
    createDraft: jest.fn(async (_c: string, email: string, vendorCode: string) =>
      draftVendor({ vendorCode, name: email, email }),
    ),
    hardDelete: jest.fn().mockResolvedValue({}),
    findById: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    company: { findFirst: jest.fn().mockResolvedValue(COMPANY) },
  };
  const mailService = { sendMail: jest.fn().mockResolvedValue({ sent: true }) };
  const tokenCache = {
    store: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
  };
  const gstinService = {
    verifyForCompany: jest.fn().mockResolvedValue({
      gstin: '33AAAAA0000A1Z5',
      verified: true,
      creditsRemaining: 24,
      suggestedFields: { gstin: '33AAAAA0000A1Z5', legalName: 'MRK ENGINEERING', status: 'Active' },
      raw: { secret: 'provider payload' },
    }),
  };

  const customFieldsValuesService = {
    loadCustomFieldsMapsForRecords: jest
      .fn()
      .mockResolvedValue(new Map([['501', options.customValues ?? {}]])),
    persistCustomFields: jest.fn().mockResolvedValue(undefined),
  };

  const service = new VendorFormInvitationService(
    repository as never,
    vendorsRepository as never,
    {
      loadFieldOverrides: jest.fn().mockResolvedValue({
        visibility: options.visibility ?? new Map(),
        registration: options.registration ?? new Map(),
      }),
    } as never,
    { findDefinitionsByCompany: jest.fn().mockResolvedValue(options.customDefs ?? []) } as never,
    customFieldsValuesService as never,
    prisma as never,
    mailService as never,
    { get: jest.fn().mockReturnValue('https://swenter.com') } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    tokenCache as never,
    gstinService as never,
    {
      getRegistrationSectionFilter: jest.fn().mockResolvedValue(
        (sectionKey: string) => !(options.registrationHiddenSections ?? []).includes(sectionKey),
      ),
    } as never,
    storageService as never,
  );

  return {
    service,
    storageService,
    repository,
    vendorsRepository,
    prisma,
    mailService,
    tx,
    gstinService,
    customFieldsValuesService,
  };
}

function normalVendor(overrides: Record<string, unknown> = {}) {
  return draftVendor({
    vendorCode: 'RM004',
    supplierType: 'RM Supplier',
    name: 'Acme',
    email: 'acme@example.com',
    ...overrides,
  });
}

type PublicForm = { form: { fields: Array<Record<string, unknown>> } };

function invitationFor(vendor: ReturnType<typeof draftVendor>, fieldSnapshot: unknown = {}) {
  return {
    id: 900n,
    vendorId: vendor.vendorId,
    companyId: vendor.companyId,
    tokenHash: hashVendorFormToken(TOKEN),
    recipientEmail: 'new.vendor@example.com',
    status: VendorFormInvitationStatus.SENT,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    fieldSnapshot,
    vendor,
    company: COMPANY,
  };
}

describe('VendorFormInvitationService — Send Vendor Registration', () => {
  it('rejects a second registration while one is pending for the same email', async () => {
    const { service, repository, vendorsRepository } = setup();
    repository.findOpenByRecipientEmail.mockResolvedValue({ id: 1n, vendorId: 2n });

    await expect(
      service.createRegistrationInvitation('28', { toEmail: 'New.Vendor@example.com', maxSendCount: 3 }, '7'),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(vendorsRepository.createDraft).not.toHaveBeenCalled();
  });

  it('creates an inactive DR draft vendor and emails the registration link', async () => {
    const { service, repository, vendorsRepository, mailService } = setup();

    const result = (await service.createRegistrationInvitation(
      '28',
      { toEmail: 'New.Vendor@example.com', maxSendCount: 3 },
      '7',
    )) as Record<string, unknown>;

    expect(vendorsRepository.nextVendorCode).toHaveBeenCalledWith('28', 'DR', expect.anything());
    expect(vendorsRepository.createDraft).toHaveBeenCalledWith(
      '28',
      'new.vendor@example.com',
      'DR001',
      '7',
      expect.anything(),
    );
    expect(result).toMatchObject({ vendorId: '501', status: 'SENT', sendCount: 1, maxSendCount: 3 });

    const snapshot = repository.create.mock.calls[0][0].fieldSnapshot;
    expect(snapshot.vendorName).toEqual({ value: '', filledBy: null });
    expect(snapshot.vendorCategory).toEqual({ value: '', filledBy: null });
    expect(snapshot).not.toHaveProperty('supplierCode');
    expect(snapshot.email).toEqual({ value: 'new.vendor@example.com', filledBy: 'INTERNAL' });

    const mail = mailService.sendMail.mock.calls[0][0];
    expect(mail.to).toBe('new.vendor@example.com');
    expect(mail.subject).toBe('Invitation to Complete Vendor Registration — Ana Machinery (P) Ltd');
    expect(mail.text).toContain('Dear Vendor,');
    expect(mail.html).toContain('https://swenter.com/vendor-form/');
    expect(mail.html).toContain('https://swenter.com/assets/logo/ana-logo.jpeg');
  });

  it('removes the draft vendor when the email cannot be sent', async () => {
    const { service, vendorsRepository, mailService } = setup();
    mailService.sendMail.mockRejectedValue(new Error('SMTP down'));

    await expect(
      service.createRegistrationInvitation('28', { toEmail: 'x@example.com', maxSendCount: 3 }, '7'),
    ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
    expect(vendorsRepository.hardDelete).toHaveBeenCalledWith('501');
  });
});

describe('VendorFormInvitationService — public GSTIN verify', () => {
  it("verifies with the invitation's company and hides raw payload and credits", async () => {
    const { service, repository, gstinService } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(draftVendor()));

    const result = await service.verifyGstinByToken(TOKEN, { gstin: '33AAAAA0000A1Z5' });

    expect(gstinService.verifyForCompany).toHaveBeenCalledWith('28', {
      gstin: '33AAAAA0000A1Z5',
      includeProfile: true,
    });
    expect(result).toEqual({
      gstin: '33AAAAA0000A1Z5',
      verified: true,
      suggestedFields: { gstin: '33AAAAA0000A1Z5', legalName: 'MRK ENGINEERING', status: 'Active' },
    });
  });

  it('rejects submitted links without calling the GSTIN provider', async () => {
    const { service, repository, gstinService } = setup();
    repository.findByTokenHash.mockResolvedValue({
      ...invitationFor(draftVendor()),
      status: VendorFormInvitationStatus.SUBMITTED,
    });

    await expect(service.verifyGstinByToken(TOKEN, { gstin: '33AAAAA0000A1Z5' })).rejects.toMatchObject({
      status: HttpStatus.GONE,
    });
    expect(gstinService.verifyForCompany).not.toHaveBeenCalled();
  });

  it('rejects unknown links without calling the GSTIN provider', async () => {
    const { service, repository, gstinService } = setup();
    repository.findByTokenHash.mockResolvedValue(null);

    await expect(service.verifyGstinByToken(TOKEN, { gstin: '33AAAAA0000A1Z5' })).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(gstinService.verifyForCompany).not.toHaveBeenCalled();
  });
});

describe('VendorFormInvitationService — public form for draft vendors', () => {
  it('returns the company name and blank, required, editable name and supplier type', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(draftVendor()));

    const form = (await service.getFormByToken(TOKEN)) as {
      company: { companyName: string };
      vendor: { vendorName: string; isDraft: boolean };
      form: { fields: Array<Record<string, unknown>> };
    };

    expect(form.company).toEqual({
      companyName: 'Ana Machinery (P) Ltd',
      logoUrl: '/assets/logo/ana-logo.jpeg',
    });
    expect(form.vendor.vendorName).toBe('');
    expect(form.vendor.isDraft).toBe(true);

    const name = form.form.fields.find((f) => f.key === 'vendorName');
    const type = form.form.fields.find((f) => f.key === 'vendorCategory');
    expect(name).toMatchObject({ editable: true, required: true, value: '' });
    expect(type).toMatchObject({ editable: true, required: true, value: '' });
    expect(type?.options).toEqual(
      expect.arrayContaining([{ value: 'RM Supplier', label: 'RM Supplier' }]),
    );
  });

  it('hides staff-only fields (code, supplier type, active, internal notes) from a normal vendor', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    const form = (await service.getFormByToken(TOKEN)) as PublicForm & {
      vendor: { vendorName: string; isDraft: boolean };
    };

    expect(form.vendor).toMatchObject({ vendorName: 'Acme', isDraft: false });
    const keys = form.form.fields.map((f) => f.key);
    for (const key of ['supplierCode', 'vendorCategory', 'isActive', 'internalNotes']) {
      expect(keys).not.toContain(key);
    }
  });

  it('requires Supplier Name on draft submit', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(draftVendor()));

    await expect(
      service.submitForm(TOKEN, { fields: { vendorName: '  ', vendorCategory: 'RM Supplier' } }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: expect.objectContaining({
        code: 'VENDOR_FORM_REQUIRED_FIELD',
        errors: [{ field: 'fields.vendorName', message: 'Name is required' }],
      }),
    });
  });

  it('rejects an unknown supplier type on draft submit', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(draftVendor()));

    await expect(
      service.submitForm(TOKEN, { fields: { vendorName: 'MRK Engineering', vendorCategory: 'Other' } }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('replaces the placeholder name, sets supplier type and assigns the real vendor code', async () => {
    const { service, repository, vendorsRepository, tx } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(draftVendor()));

    await service.submitForm(TOKEN, {
      fields: { vendorName: ' MRK Engineering ', vendorCategory: 'Component Supplier' },
    });

    expect(vendorsRepository.nextVendorCode).toHaveBeenCalledWith('28', 'CS', tx);
    const update = tx.vendor.update.mock.calls[0][0];
    expect(update.where).toEqual({ vendorId: 501n });
    expect(update.data).toMatchObject({
      name: 'MRK Engineering',
      supplierType: 'Component Supplier',
      vendorCode: 'CS001',
    });
    expect(update.data).not.toHaveProperty('isActive');
    expect(repository.markSubmitted).toHaveBeenCalled();
  });

  it('ignores supplier type, code and active sent by a normal vendor', async () => {
    const { service, repository, vendorsRepository, tx } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    await service.submitForm(TOKEN, {
      fields: {
        vendorCategory: 'Service Provider',
        supplierCode: 'XX999',
        isActive: true,
        city: 'Chennai',
      },
    });

    expect(vendorsRepository.nextVendorCode).not.toHaveBeenCalled();
    const update = tx.vendor.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ city: 'Chennai' });
    for (const key of ['supplierType', 'vendorCode', 'isActive']) {
      expect(update.data).not.toHaveProperty(key);
    }
  });
});

describe('VendorFormInvitationService — registration form field settings', () => {
  it('builds each field with name, type, section, readOnly, helpText and the current value', async () => {
    const { service, repository } = setup({
      customDefs: [
        customDef({ helpText: '15 characters' }),
        customDef({
          fieldId: 72n,
          fieldName: 'msmeType',
          displayName: 'MSME type',
          fieldType: 'dropdown',
          sectionKey: 'general',
          sortOrder: 1,
          options: [
            { value: 'SMALL', label: 'Small', displayOrder: 2 },
            { value: 'MICRO', label: 'Micro', displayOrder: 1 },
          ],
        }),
      ],
      customValues: { gstin: '33AAAAA0000A1Z5' },
    });
    repository.findByTokenHash.mockResolvedValue(
      invitationFor(normalVendor({ phone: '+919876543210' })),
    );

    const { form } = (await service.getFormByToken(TOKEN)) as PublicForm;
    const byKey = Object.fromEntries(form.fields.map((f) => [f.name, f]));

    expect(byKey.phone).toMatchObject({
      name: 'phone',
      type: 'phone',
      fieldType: 'phone',
      section: 'contact',
      readOnly: false,
      value: '+919876543210',
    });
    expect(byKey.mobile).toMatchObject({ type: 'phone', value: '' });
    expect(byKey.gstin).toMatchObject({
      type: 'text',
      section: 'general',
      helpText: '15 characters',
      value: '33AAAAA0000A1Z5',
    });
    expect(byKey.msmeType).toMatchObject({
      type: 'dropdown',
      options: [
        { value: 'MICRO', label: 'Micro' },
        { value: 'SMALL', label: 'Small' },
      ],
    });

    const order = form.fields.map((f) => f.name);
    expect(order.indexOf('vendorName')).toBeLessThan(order.indexOf('msmeType'));
    expect(order.indexOf('msmeType')).toBeLessThan(order.indexOf('gstin'));
    expect(order.indexOf('gstin')).toBeLessThan(order.indexOf('email'));
  });

  it('reads the setting when the link is opened: fields switched off are gone, others stay', async () => {
    const { service, repository } = setup({
      registration: new Map([
        ['bankName', false],
        ['bankAccount', false],
      ]),
      customDefs: [customDef({ isRegistrationVisible: false })],
    });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    const { form } = (await service.getFormByToken(TOKEN)) as PublicForm;
    const keys = form.fields.map((f) => f.name);

    expect(keys).not.toContain('bankName');
    expect(keys).not.toContain('bankAccount');
    expect(keys).not.toContain('gstin');
    expect(keys).toContain('bankIban');
  });

  it('leaves out every field of a tab switched off for registration, including custom fields', async () => {
    const { service, repository } = setup({
      registrationHiddenSections: ['accounting'],
      customDefs: [customDef({ sectionKey: 'accounting' })],
    });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    const { form } = (await service.getFormByToken(TOKEN)) as PublicForm;

    expect(form.fields.filter((f) => f.section === 'accounting')).toEqual([]);
    expect(form.fields.map((f) => f.name)).toContain('bankName');
  });

  it('preview returns the same fields as a new vendor link, with empty values', async () => {
    const { service, repository } = setup({
      registrationHiddenSections: ['bank'],
      customDefs: [customDef()],
    });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    const preview = (await service.getRegistrationPreview('28')) as PublicForm & {
      company: { companyName: string };
    };
    const { form } = (await service.getFormByToken(TOKEN)) as PublicForm;

    expect(preview.company).toEqual({
      companyName: 'Ana Machinery (P) Ltd',
      logoUrl: '/assets/logo/ana-logo.jpeg',
    });
    expect(preview.form.fields.map((f) => f.name)).toEqual(form.fields.map((f) => f.name));
    expect(preview.form.fields.every((f) => f.value === '' && f.filledBy === null)).toBe(true);
    expect(preview.form.fields.some((f) => f.section === 'bank')).toBe(false);
  });

  it('hides fields that are hidden on Add Vendor, including hidden custom fields', async () => {
    const { service, repository } = setup({
      visibility: new Map([['fax', false]]),
      customDefs: [customDef({ isHidden: true })],
    });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    const { form } = (await service.getFormByToken(TOKEN)) as PublicForm;
    const keys = form.fields.map((f) => f.name);

    expect(keys).not.toContain('fax');
    expect(keys).not.toContain('gstin');
  });

  it('does not require or save a required field that is switched off for registration', async () => {
    const { service, repository, customFieldsValuesService } = setup({
      customDefs: [customDef({ isRequired: true, isRegistrationVisible: false })],
    });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    await service.submitForm(TOKEN, { fields: { city: 'Chennai', gstin: 'OVERWRITE' } });

    expect(customFieldsValuesService.persistCustomFields).not.toHaveBeenCalled();
    expect(repository.markSubmitted).toHaveBeenCalled();
  });

  it('requires visible required fields, using the saved value when the key is omitted', async () => {
    const { service, repository } = setup({
      customDefs: [customDef({ isRequired: true })],
    });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    await expect(service.submitForm(TOKEN, { fields: { city: 'Chennai' } })).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: expect.objectContaining({
        code: 'VENDOR_FORM_REQUIRED_FIELD',
        errors: [{ field: 'fields.gstin', message: 'GSTIN is required' }],
      }),
    });

    const saved = setup({
      customDefs: [customDef({ isRequired: true })],
      customValues: { gstin: '33AAAAA0000A1Z5' },
    });
    saved.repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));
    await expect(
      saved.service.submitForm(TOKEN, { fields: { city: 'Chennai' } }),
    ).resolves.toMatchObject({ success: true });
  });

  it('stores phones as E.164 like Add Vendor and rejects invalid numbers', async () => {
    const { service, repository, tx } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    await service.submitForm(TOKEN, {
      fields: { phone: '+91 98765 43210', mobile: '9876543211', tel2: '' },
    });

    const update = tx.vendor.update.mock.calls[0][0];
    expect(update.data.phone).toBe('+919876543210');
    expect(update.data.metadata).toMatchObject({ mobile: '+919876543211', tel2: '' });

    const bad = setup();
    bad.repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));
    await expect(bad.service.submitForm(TOKEN, { fields: { phone: '12' } })).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: expect.objectContaining({
        code: 'VENDOR_FORM_INVALID_FIELD',
        errors: [{ field: 'fields.phone', message: 'Tel 1 is not a valid phone number' }],
      }),
    });
  });
});

describe('VendorFormInvitationService — company logo on the vendor link', () => {
  it.each([
    ['https://storage.googleapis.com/erp-files/28/logo.png', 'https://storage.googleapis.com/erp-files/28/logo.png?X-Goog-Signature=abc'],
    ['https://cdn.example.com/logo.png', 'https://cdn.example.com/logo.png'],
    ['  ', null],
    [null, null],
    ['logo.png', null],
  ])('logo_url %p -> %p', async (logoUrl, expected) => {
    const { service, repository, prisma } = setup();
    const company = { ...COMPANY, logoUrl };
    repository.findByTokenHash.mockResolvedValue({ ...invitationFor(normalVendor()), company });
    prisma.company.findFirst.mockResolvedValue(company);

    const form = (await service.getFormByToken(TOKEN)) as { company: { logoUrl: string | null } };
    const preview = (await service.getRegistrationPreview('28')) as { company: { logoUrl: string | null } };

    expect(form.company.logoUrl).toBe(expected);
    expect(preview.company.logoUrl).toBe(expected);
  });
});

describe('VendorFormInvitationService — attachments on the vendor link', () => {
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
  const pdfFile = (name = 'GST.pdf', buffer = PDF) => ({
    originalname: name,
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
  });
  const linkFile = (fileAssetId: string, invitationId = '900') => ({
    fileAssetId,
    fileName: `${fileAssetId}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 10,
    storageKey: `28/${fileAssetId}`,
    uploadedAt: '2026-09-28T10:00:00.000Z',
    status: 'uploaded',
    source: 'VENDOR_LINK',
    uploadedBy: 'Vendor',
    invitationId,
  });
  const staffFile = { fileAssetId: 'staff-1', fileName: 'Internal.pdf', storageKey: '28/internal' };
  const metadataWith = (...attachments: unknown[]) => ({ bankName: 'SBI', attachments });

  it('GET lists only files uploaded through this invitation, without storage keys', async () => {
    const { service, repository } = setup();
    const metadata = metadataWith(staffFile, linkFile('mine'), linkFile('other-link', '899'));
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor({ metadata })));

    const form = (await service.getFormByToken(TOKEN)) as { attachments: Record<string, unknown> };

    expect(form.attachments).toEqual({
      enabled: true,
      required: false,
      maxFiles: 10,
      maxBytes: 10485760,
      accept: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png', '.webp'],
      files: [
        {
          fileAssetId: 'mine',
          fileName: 'mine.pdf',
          fileSize: 10,
          mimeType: 'application/pdf',
          uploadedAt: '2026-09-28T10:00:00.000Z',
        },
      ],
    });
  });

  it('attachments tab off: block disabled and uploads refused with 403', async () => {
    const { service, repository, storageService } = setup({ registrationHiddenSections: ['attachments'] });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    const form = (await service.getFormByToken(TOKEN)) as { attachments: Record<string, unknown> };
    expect(form.attachments).toMatchObject({ enabled: false, files: [] });

    await expect(service.uploadAttachmentsByToken(TOKEN, [pdfFile()])).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: expect.objectContaining({ code: 'VENDOR_FORM_ATTACHMENTS_DISABLED' }),
    });
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it('uploads under the vendor, tags VENDOR_LINK and keeps staff attachments', async () => {
    const metadata = metadataWith(staffFile);
    const { service, repository, storageService, tx } = setup({ lockedVendorMetadata: metadata });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor({ metadata })));

    const result = await service.uploadAttachmentsByToken(TOKEN, [pdfFile()]);

    expect(storageService.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: '28', mimeType: 'application/pdf', entityType: 'vendor', entityId: '501' }),
    );
    const saved = tx.vendor.update.mock.calls[0][0].data.metadata;
    expect(saved.bankName).toBe('SBI');
    expect(saved.attachments).toEqual([
      staffFile,
      expect.objectContaining({ fileAssetId: 'asset-1', source: 'VENDOR_LINK', uploadedBy: 'Vendor', invitationId: '900' }),
    ]);
    expect(result).toEqual({
      files: [
        {
          fileAssetId: 'asset-1',
          fileName: 'GST.pdf',
          fileSize: PDF.length,
          mimeType: 'application/pdf',
          uploadedAt: '2026-09-29T10:00:00.000Z',
        },
      ],
    });
  });

  it('checks the real file content, not only the name', async () => {
    const { service, repository, storageService } = setup();
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor()));

    for (const file of [pdfFile('GST.pdf', Buffer.from('MZ\x90\x00 fake exe')), pdfFile('run.exe')]) {
      await expect(service.uploadAttachmentsByToken(TOKEN, [file])).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'VENDOR_FORM_ATTACHMENT_TYPE',
          message: `${file.originalname} — file type not allowed`,
        }),
      });
    }
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it('limits files per invitation', async () => {
    const own = Array.from({ length: 9 }, (_, i) => linkFile(`f${i}`));
    const { service, repository, storageService } = setup();
    repository.findByTokenHash.mockResolvedValue(
      invitationFor(normalVendor({ metadata: metadataWith(staffFile, ...own) })),
    );

    await expect(
      service.uploadAttachmentsByToken(TOKEN, [pdfFile('a.pdf'), pdfFile('b.pdf')]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VENDOR_FORM_ATTACHMENT_LIMIT',
        message: 'You can upload up to 10 files',
      }),
    });
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it('refuses uploads on a submitted link with the usual code', async () => {
    const { service, repository } = setup();
    repository.findByTokenHash.mockResolvedValue({
      ...invitationFor(normalVendor()),
      status: VendorFormInvitationStatus.SUBMITTED,
    });

    await expect(service.uploadAttachmentsByToken(TOKEN, [pdfFile()])).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VENDOR_FORM_ALREADY_SUBMITTED' }),
    });
  });

  it('DELETE removes only this invitation\'s file; staff or other files are 404', async () => {
    const metadata = metadataWith(staffFile, linkFile('mine'), linkFile('keep'));
    const { service, repository, storageService, tx } = setup({ lockedVendorMetadata: metadata });
    repository.findByTokenHash.mockResolvedValue(invitationFor(normalVendor({ metadata })));

    await expect(service.deleteAttachmentByToken(TOKEN, 'staff-1')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });

    const result = (await service.deleteAttachmentByToken(TOKEN, 'mine')) as {
      files: Array<{ fileAssetId: string }>;
    };
    expect(storageService.deleteFile).toHaveBeenCalledWith('28', 'mine', {
      entityType: 'vendor',
      entityId: '501',
    });
    expect(tx.vendor.update.mock.calls[0][0].data.metadata.attachments).toEqual([
      staffFile,
      expect.objectContaining({ fileAssetId: 'keep' }),
    ]);
    expect(result.files.map((f) => f.fileAssetId)).toEqual(['keep']);
  });

  it('preview carries the attachments block with no files', async () => {
    const { service } = setup();
    const preview = (await service.getRegistrationPreview('28')) as { attachments: Record<string, unknown> };
    expect(preview.attachments).toMatchObject({ enabled: true, required: false, files: [] });
  });
});
