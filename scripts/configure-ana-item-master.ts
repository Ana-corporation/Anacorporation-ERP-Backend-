/**
 * ANA Item Master layout through the normal settings (Form Configuration + Tab Access), plus a
 * starter UOM list. Nothing here is ANA-specific code: other companies keep the default form.
 *
 *   Store* → Category* → Part Number → Part Name → Inventory Item | Inventory UOM* → Status
 *   Remarks tab, Attachments tab (Picture). Every other item field / tab is hidden.
 *
 * Idempotent. Run (DEV):
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/configure-ana-item-master.ts --companyId 28 --dry-run
 * Drop --dry-run to write. Use `production` instead of `development` for LIVE.
 */
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CustomFieldsRepository } from '@/modules/shared/custom-fields/custom-fields.repository';
import { getBuiltInFields } from '@/modules/shared/form-configuration/built-in-field-registry';
import { FormConfigurationRepository } from '@/modules/shared/form-configuration/form-configuration.repository';
import { FormConfigurationService } from '@/modules/shared/form-configuration/form-configuration.service';
import { TabAccessRepository } from '@/modules/shared/tab-access/tab-access.repository';
import { TabAccessService } from '@/modules/shared/tab-access/tab-access.service';

/** Shown fields with label / mandatory. Protected fields (itemCode, description, isInventoryItem,
 * status) are always shown; they are listed for label and order only. */
const SHOWN: Record<string, { label?: string; required?: boolean }> = {
  storeCategoryId: { label: 'Store', required: true },
  itemCode: { label: 'Part Number' },
  description: { label: 'Part Name' },
  isInventoryItem: { label: 'Inventory Item' },
  itemGroupId: { label: 'Category', required: true },
  inventoryUomId: { label: 'Inventory UOM', required: true },
  status: { label: 'Status' },
  remarks: { label: 'Remarks' },
  imageFileAssetId: { label: 'Picture / Image Reference' },
};

/** Field order inside a section; fields not listed keep their current order after these. */
const ORDER: Record<string, string[]> = {
  header: ['storeCategoryId', 'itemGroupId', 'itemCode', 'description', 'isInventoryItem'],
  general: ['inventoryUomId', 'status'],
};

const HIDDEN_TABS = ['classification', 'purchasing', 'sales', 'inventory', 'planning', 'production', 'properties'];

const UOMS: Array<[string, string]> = [
  ['NOS', 'Numbers'],
  ['KG', 'Kilogram'],
  ['MTR', 'Metre'],
  ['LTR', 'Litre'],
  ['SET', 'Set'],
  ['PAIR', 'Pair'],
];

function parseArgs(argv: string[]) {
  const idx = argv.indexOf('--companyId');
  const raw = idx >= 0 ? argv[idx + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('Usage: configure-ana-item-master.ts --companyId <id> [--dry-run]');
  return { companyId: raw, dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { companyId, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const tabAccess = new TabAccessService(new TabAccessRepository(prisma));
  const formConfig = new FormConfigurationService(
    new FormConfigurationRepository(prisma),
    tabAccess,
    new CustomFieldsRepository(prisma),
    audit,
  );
  const say = (msg: string) => console.log(`${dryRun ? 'PLAN' : 'DONE'}  ${msg}`);

  try {
    const company = await prisma.company.findFirst({
      where: { companyId: BigInt(companyId), deletedAt: null },
      select: { companyCode: true },
    });
    if (!company) throw new Error(`Company ${companyId} not found`);
    console.log(`Company ${companyId} (${company.companyCode})${dryRun ? ' — DRY RUN' : ''}`);

    // 1) Show / hide, mandatory, labels
    const fields = getBuiltInFields('item').map((field) => {
      const shown = SHOWN[field.fieldKey];
      if (!field.configurable) {
        return shown?.label ? { fieldKey: field.fieldKey, label: shown.label } : null;
      }
      return shown
        ? { fieldKey: field.fieldKey, isVisible: true, isRequired: Boolean(shown.required), label: shown.label ?? null }
        : { fieldKey: field.fieldKey, isVisible: false, isRequired: false, label: null };
    });
    const rows = fields.filter((f): f is NonNullable<typeof f> => f !== null);
    say(`fields shown: ${Object.keys(SHOWN).join(', ')}`);
    say(`fields hidden: ${rows.filter((r) => 'isVisible' in r && r.isVisible === false).length}`);
    say(`mandatory: ${Object.entries(SHOWN).filter(([, v]) => v.required).map(([k]) => k).join(', ')}`);
    if (!dryRun) await formConfig.updateConfiguration(companyId, 'item', { fields: rows });

    // 2) Field order (each section must list all of its fields)
    const config = await formConfig.getConfiguration(companyId, 'item');
    const sections = Object.entries(ORDER).map(([sectionKey, first]) => {
      const current = config.sections.find((s) => s.sectionKey === sectionKey)?.fields ?? [];
      const ordered = [
        ...first.map((key) => current.find((f) => f.fieldKey === key && f.source === 'BUILT_IN')).filter(Boolean),
        ...current.filter((f) => !(first.includes(f.fieldKey) && f.source === 'BUILT_IN')),
      ] as typeof current;
      return {
        sectionKey,
        fields: ordered.map((f, i) => ({ fieldKey: f.fieldKey, source: f.source, displayOrder: (i + 1) * 10 })),
      };
    });
    for (const s of sections) say(`order ${s.sectionKey}: ${s.fields.slice(0, ORDER[s.sectionKey].length).map((f) => f.fieldKey).join(' → ')}`);
    if (!dryRun) await formConfig.updateFieldOrder(companyId, 'item', { sections }, '');

    // 3) Tabs hidden for every role
    say(`tabs hidden for all roles: ${HIDDEN_TABS.join(', ')}`);
    if (!dryRun) {
      for (const tabKey of HIDDEN_TABS) await tabAccess.updateTabAccess(companyId, 'item', tabKey, { roleIds: [] });
    }

    // 4) Starter UOMs (existing codes are kept)
    const existing = new Set(
      (await prisma.uom.findMany({ where: { companyId: BigInt(companyId), deletedAt: null }, select: { code: true } })).map(
        (u) => u.code,
      ),
    );
    const missing = UOMS.filter(([code]) => !existing.has(code));
    say(`UOMs to add: ${missing.map(([c]) => c).join(', ') || '(none)'}`);
    if (!dryRun && missing.length) {
      await prisma.uom.createMany({ data: missing.map(([code, name]) => ({ companyId: BigInt(companyId), code, name })) });
    }

    console.log(dryRun ? 'Dry run — nothing written.' : 'ANA item master configured.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
