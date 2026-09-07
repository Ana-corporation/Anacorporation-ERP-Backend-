/** Tenant companyCode: A-Z 0-9 _ - , max 30. Auto pattern CO-000001. */

const MAX_LEN = 30;
const AUTO_PREFIX = 'CO';
const AUTO_RE = /^CO-(\d{6})$/;

export function slugCompanyCodeFromName(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return slug.slice(0, MAX_LEN);
}

export function formatAutoCompanyCode(sequence: number): string {
  const n = Math.max(1, Math.floor(sequence));
  return `${AUTO_PREFIX}-${String(n).padStart(6, '0')}`;
}

export function parseAutoCompanySequence(code: string): number | null {
  const m = code.trim().toUpperCase().match(AUTO_RE);
  if (!m) return null;
  return Number(m[1]);
}

/** Unique candidates: NAME, NAME_2… then CO-000001 style. */
export function companyCodeCandidates(name: string, nextAutoSeq: number): string[] {
  const out: string[] = [];
  const slug = slugCompanyCodeFromName(name);
  if (slug.length > 0) {
    out.push(slug);
    for (let i = 2; i <= 99; i += 1) {
      const suffix = `_${i}`;
      const base = slug.slice(0, MAX_LEN - suffix.length);
      if (!base) break;
      out.push(`${base}${suffix}`);
    }
  }
  out.push(formatAutoCompanyCode(nextAutoSeq));
  return out;
}
