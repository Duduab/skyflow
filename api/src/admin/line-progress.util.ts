import {
  assembledFromLogPayload,
  computeSiteAssemblyPercent,
  type SiteExpectedCounts,
} from '../common/site-assembly.util';

/**
 * Mirrors web `station-progress.ts` / worker hub `averageOverallPercent`
 * so admin dashboard progress matches station reporting.
 */
export function stationProgressPercent(
  stationId: number,
  totalItems: number,
  qty: (sid: number) => number,
): number {
  const doneRaw = qty(stationId);
  if (stationId === 1) {
    const target = totalItems;
    return target > 0
      ? Math.min(100, Math.round((doneRaw / target) * 100))
      : 0;
  }
  if (stationId === 6) {
    const target = totalItems;
    const done = qty(6);
    return target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  }
  if (stationId === 5) {
    return doneRaw >= 1 ? 100 : 0;
  }
  const target = qty(stationId - 1);
  const done = doneRaw;
  return target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
}

/** Seven stations: 1–6 from logs + station 7 from site assembly (or 0). */
export function averageOverallLinePercent(
  totalItems: number,
  qty: (sid: number) => number,
  stationSevenPct?: number,
): number {
  let sum = 0;
  for (let id = 1; id <= 6; id++) {
    sum += stationProgressPercent(id, totalItems, qty);
  }
  sum += stationSevenPct ?? 0;
  return Math.round(sum / 7);
}

export function siteLinePercentFromOrderRow(
  deliveryPath: string | null | undefined,
  expected: SiteExpectedCounts,
  latestLogExtra: unknown,
): number {
  return computeSiteAssemblyPercent(
    deliveryPath,
    expected,
    assembledFromLogPayload(latestLogExtra),
  );
}
