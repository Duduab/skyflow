import type { ProjectOrder } from '@prisma/client';
import {
  assembledFromLogPayload,
  computeSiteAssemblyPercent,
} from './site-assembly.util';

/** Mirrors web `computeStationProgress` / `station-progress.ts` for completion checks. */
export function stationProgressPercentForCompletion(
  stationId: number,
  order: Pick<
    ProjectOrder,
    | 'totalItems'
    | 'siteDeliveryNotePath'
    | 'siteExpectedBeams'
    | 'siteExpectedGlazing'
    | 'siteExpectedUnitized'
  >,
  qty: (sid: number) => number,
  latestStation7Extra: unknown,
): number {
  const qtyAt = qty;
  const doneRaw = qtyAt(stationId);

  if (stationId === 1) {
    const target = order.totalItems;
    return target > 0
      ? Math.min(100, Math.round((doneRaw / target) * 100))
      : 0;
  }

  if (stationId === 7) {
    const expB = order.siteExpectedBeams ?? 0;
    const expG = order.siteExpectedGlazing ?? 0;
    const expU = order.siteExpectedUnitized ?? 0;
    const ep = assembledFromLogPayload(latestStation7Extra);
    return computeSiteAssemblyPercent(
      order.siteDeliveryNotePath,
      { beams: expB, glazing: expG, unitized: expU },
      {
        beams: ep.beams,
        glazing: ep.glazing,
        unitized: ep.unitized,
      },
    );
  }

  if (stationId === 6) {
    const target = order.totalItems;
    const done = qtyAt(6);
    return target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  }

  if (stationId === 5) {
    return doneRaw >= 1 ? 100 : 0;
  }

  const target = qtyAt(stationId - 1);
  const done = doneRaw;
  return target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
}

export function isProjectProductionComplete(
  order: Pick<
    ProjectOrder,
    | 'totalItems'
    | 'siteDeliveryNotePath'
    | 'siteExpectedBeams'
    | 'siteExpectedGlazing'
    | 'siteExpectedUnitized'
  >,
  qty: (sid: number) => number,
  latestStation7Extra: unknown,
): boolean {
  for (let sid = 1; sid <= 7; sid++) {
    const pct = stationProgressPercentForCompletion(
      sid,
      order,
      qty,
      latestStation7Extra,
    );
    if (pct < 100) return false;
  }
  return true;
}
