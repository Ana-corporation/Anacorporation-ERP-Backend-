/**
 * GSTIN verification via gstinapi.in (verify-only; no e-way / e-invoice).
 * Enabled for allow-listed company codes (default: ANA_MACHINERY_P_LTD).
 */
export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const GSTIN_API_BASE_URL = 'https://www.gstinapi.in';

/** Sandbox GSTIN from gstinapi.in docs (0 credits, mock data). */
export const GSTIN_SANDBOX_TEST_NUMBER = '00AAAAA0000A1ZT';

export const DEFAULT_GSTIN_ENABLED_COMPANY_CODES = ['ANA_MACHINERY_P_LTD'] as const;

export function normalizeGstin(raw: string): string {
  return String(raw || '').trim().toUpperCase();
}

export function isValidGstinPattern(gstin: string): boolean {
  return GSTIN_REGEX.test(normalizeGstin(gstin));
}

export function parseGstinEnabledCompanyCodes(
  raw = process.env.GSTIN_ENABLED_COMPANY_CODES,
): string[] {
  const value = String(raw || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return value.length > 0 ? value : [...DEFAULT_GSTIN_ENABLED_COMPANY_CODES];
}
