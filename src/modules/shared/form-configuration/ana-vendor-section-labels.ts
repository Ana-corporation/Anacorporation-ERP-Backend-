/**
 * Ana Machinery (companyId 28) — Vendor form section title overrides only.
 * Does not affect other companies.
 */
export const ANA_MACHINERY_COMPANY_ID = '28';

/** Doc: Vendor Module Testing — section renames for Ana only. */
export const ANA_VENDOR_SECTION_LABELS: Readonly<Record<string, string>> = {
  payment: 'Payment',
  bank: "Vendor's Bank details",
  paymentRun: 'Our Bank details',
};

export function resolveVendorSectionDefsForCompany(
  companyId: string,
  sectionDefs: ReadonlyArray<{ key: string; label: string }>,
): Array<{ key: string; label: string }> {
  if (String(companyId) !== ANA_MACHINERY_COMPANY_ID) {
    return sectionDefs.map((s) => ({ key: s.key, label: s.label }));
  }
  return sectionDefs.map((s) => ({
    key: s.key,
    label: ANA_VENDOR_SECTION_LABELS[s.key] ?? s.label,
  }));
}
