/** Catalog saw profiles from planning Excel (MPS/MPB X2). */
export const CATALOG_PROFILE_CODES = [
  'MPS-X',
  'MPS-Y',
  'MPB-X',
  'MPB-Y',
] as const;

export type ProfileKind = 'CATALOG' | 'DRAWN';

export type CatalogProfileCode = (typeof CATALOG_PROFILE_CODES)[number];

export function isCatalogProfileCode(code: string): code is CatalogProfileCode {
  return (CATALOG_PROFILE_CODES as readonly string[]).includes(code);
}

export function profileKindFromCode(profileCode: string): ProfileKind {
  return isCatalogProfileCode(profileCode.trim().toUpperCase())
    ? 'CATALOG'
    : 'DRAWN';
}

const PROFILE_CODE_ALIASES: Record<string, string> = {
  'MBP-X': 'MPB-X',
  'MBP-Y': 'MPB-Y',
  'MSP-X': 'MPS-X',
  'MSP-Y': 'MPS-Y',
};

/** Normalize free-text / legacy scrap rows. */
export function normalizeProfileCode(raw: string | null | undefined): string {
  const t = (raw ?? '').trim().toUpperCase();
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

export interface SimNeedLineInput {
  profileKind: ProfileKind;
  profileCode: string;
  qty: number;
  lengthMm: number;
}

export interface SimNeedLineResult extends SimNeedLineInput {
  needMm: number;
  availableQty: number;
  availableMm: number;
  coveredQty: number;
  coveredMm: number;
  gapQty: number;
  gapMm: number;
  enough: boolean;
}

/** Allocate scrap pieces (exact length + profile match) against need lines. */
export function evaluateProfileSimulation(
  inventory: ProfileInventoryRow[],
  needLines: SimNeedLineInput[],
): {
  lines: SimNeedLineResult[];
  totalNeedMm: number;
  totalCoveredMm: number;
  totalGapMm: number;
  enough: boolean;
} {
  const pool = inventory.map((r) => ({ ...r, qtyLeft: r.qty }));

  const results: SimNeedLineResult[] = [];

  for (const need of needLines) {
    const code = normalizeProfileCode(need.profileCode);
    const kind = need.profileKind;
    const needQty = Math.max(0, Math.floor(need.qty));
    const lengthMm = Math.max(0, Math.round(need.lengthMm));
    const needMm = needQty * lengthMm;

    let availableQty = 0;
    let availableMm = 0;
    for (const bucket of pool) {
      if (bucket.profileKind !== kind || bucket.profileCode !== code) continue;
      if (bucket.lengthMm !== lengthMm) continue;
      availableQty += bucket.qtyLeft;
      availableMm += bucket.qtyLeft * bucket.lengthMm;
    }

    let coveredQty = 0;
    for (const bucket of pool) {
      if (bucket.profileKind !== kind || bucket.profileCode !== code) continue;
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
      profileKind: kind,
      profileCode: code,
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

export function aggregateScrapReports(
  rows: {
    profileKind: string;
    profileCode: string;
    itemLength: unknown;
    scrapQty: number;
  }[],
): ProfileInventoryRow[] {
  const map = new Map<string, ProfileInventoryRow>();
  for (const r of rows) {
    const profileCode = normalizeProfileCode(r.profileCode);
    const profileKind = (
      r.profileKind === 'DRAWN' ? 'DRAWN' : 'CATALOG'
    ) as ProfileKind;
    const lengthMm = Math.round(Number(r.itemLength));
    const qty = Math.max(0, r.scrapQty);
    if (lengthMm <= 0 || qty <= 0) continue;
    const key = `${profileKind}|${profileCode}|${lengthMm}`;
    const prev = map.get(key);
    if (prev) {
      prev.qty += qty;
      prev.totalMm += qty * lengthMm;
    } else {
      map.set(key, {
        profileKind,
        profileCode,
        lengthMm,
        qty,
        totalMm: qty * lengthMm,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.profileCode.localeCompare(b.profileCode),
  );
}
