export const CATALOG_PROFILE_CODES = [
  'MPS-X',
  'MPS-Y',
  'MPB-X',
  'MPB-Y',
] as const;

export type ProfileKind = 'CATALOG' | 'DRAWN';

export type CatalogProfileCode = (typeof CATALOG_PROFILE_CODES)[number];

export function isCatalogProfileCode(code: string): boolean {
  return (CATALOG_PROFILE_CODES as readonly string[]).includes(
    code.trim().toUpperCase(),
  );
}

export function profileKindFromCode(profileCode: string): ProfileKind {
  return isCatalogProfileCode(profileCode) ? 'CATALOG' : 'DRAWN';
}

/** Common typos (MBP ↔ MPB, MSP ↔ MPS) when typing drawn profiles. */
const PROFILE_CODE_ALIASES: Record<string, string> = {
  'MBP-X': 'MPB-X',
  'MBP-Y': 'MPB-Y',
  'MSP-X': 'MPS-X',
  'MSP-Y': 'MPS-Y',
};

export function normalizeProfileCode(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!t) return 'LEGACY';
  const aliased = PROFILE_CODE_ALIASES[t] ?? t;
  if (isCatalogProfileCode(aliased)) return aliased;
  return aliased.slice(0, 32);
}

export interface ProfileInventoryRow {
  profileKind: ProfileKind;
  profileCode: string;
  lengthMm: number;
  qty: number;
  totalMm: number;
}

export interface SimProfileNeedLine {
  profileKind: ProfileKind;
  profileCode: string;
  qty: number;
  lengthMm: number;
}

export interface SimProfileNeedResult extends SimProfileNeedLine {
  needMm: number;
  availableQty: number;
  availableMm: number;
  coveredQty: number;
  coveredMm: number;
  gapQty: number;
  gapMm: number;
  enough: boolean;
}

export function evaluateProfileSimulation(
  inventory: ProfileInventoryRow[],
  needLines: SimProfileNeedLine[],
): {
  lines: SimProfileNeedResult[];
  totalNeedMm: number;
  totalCoveredMm: number;
  totalGapMm: number;
  enough: boolean;
} {
  const pool = inventory.map((r) => ({ ...r, qtyLeft: r.qty }));
  const results: SimProfileNeedResult[] = [];

  for (const need of needLines) {
    const profileCode = normalizeProfileCode(need.profileCode);
    const profileKind = need.profileKind;
    const needQty = Math.max(0, Math.floor(need.qty));
    const lengthMm = Math.max(0, Math.round(need.lengthMm));
    const needMm = needQty * lengthMm;

    let availableQty = 0;
    for (const bucket of pool) {
      if (bucket.profileKind !== profileKind || bucket.profileCode !== profileCode) {
        continue;
      }
      if (bucket.lengthMm !== lengthMm) continue;
      availableQty += bucket.qtyLeft;
    }
    const availableMm = availableQty * lengthMm;

    let coveredQty = 0;
    for (const bucket of pool) {
      if (bucket.profileKind !== profileKind || bucket.profileCode !== profileCode) {
        continue;
      }
      if (bucket.lengthMm !== lengthMm) continue;
      if (needQty <= coveredQty) break;
      const take = Math.min(bucket.qtyLeft, needQty - coveredQty);
      bucket.qtyLeft -= take;
      coveredQty += take;
    }

    const coveredMm = coveredQty * lengthMm;
    const gapQty = Math.max(0, needQty - coveredQty);
    const gapMm = gapQty * lengthMm;

    results.push({
      profileKind,
      profileCode,
      qty: needQty,
      lengthMm,
      needMm,
      availableQty,
      availableMm,
      coveredQty,
      coveredMm,
      gapQty,
      gapMm,
      enough: gapQty === 0 && needQty > 0,
    });
  }

  const totalNeedMm = results.reduce((s, r) => s + r.needMm, 0);
  const totalCoveredMm = results.reduce((s, r) => s + r.coveredMm, 0);
  const totalGapMm = results.reduce((s, r) => s + r.gapMm, 0);

  return {
    lines: results,
    totalNeedMm,
    totalCoveredMm,
    totalGapMm,
    enough: totalGapMm === 0 && totalNeedMm > 0,
  };
}
