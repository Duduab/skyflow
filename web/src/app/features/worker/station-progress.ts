import {
  SiteAssemblyContext,
  WorkerContext,
} from '../../core/skyflow.models';

/** SVG ring math (viewBox 0–100, r=42) — same as worker terminal */
export const PROGRESS_RING_C = 2 * Math.PI * 42;

export interface StationProgressVm {
  done: number;
  target: number;
  remaining: number;
  percent: number;
  /** Stations 2–4: no upstream qty yet */
  noUpstreamTarget: boolean;
}

export function progressDashOffset(percent: number): number {
  return (
    PROGRESS_RING_C *
    (1 - Math.min(100, Math.max(0, percent)) / 100)
  );
}

function qtyAt(ctx: WorkerContext, stationId: number): number {
  return ctx.totals.find((t) => t.stationId === stationId)?.processedQty ?? 0;
}

function siteAssemblyPercent(s: SiteAssemblyContext): number {
  if (!s.deliveryNoteUrl?.trim()) return 0;
  const r = (a: number, e: number) =>
    e > 0 ? Math.min(100, Math.round((a / e) * 100)) : 0;
  return Math.round(
    (r(s.assembledBeams, s.expectedBeams) +
      r(s.assembledGlazing, s.expectedGlazing) +
      r(s.assembledUnitized, s.expectedUnitized)) /
      3,
  );
}

/** Cumulative progress vs target for a station (same rules as worker terminal). */
export function computeStationProgress(
  stationId: number,
  ctx: WorkerContext,
): StationProgressVm {
  const sid = stationId;
  const doneRaw = qtyAt(ctx, sid);

  if (sid === 1) {
    const target = ctx.order.totalItems;
    const done = doneRaw;
    const remaining = Math.max(0, target - done);
    const percent =
      target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
    return {
      done,
      target,
      remaining,
      percent,
      noUpstreamTarget: false,
    };
  }

  if (sid === 7) {
    const s = ctx.siteAssembly;
    if (!s) {
      return {
        done: 0,
        target: 1,
        remaining: 1,
        percent: 0,
        noUpstreamTarget: false,
      };
    }
    const expSum =
      s.expectedBeams + s.expectedGlazing + s.expectedUnitized;
    const asmSum =
      s.assembledBeams + s.assembledGlazing + s.assembledUnitized;
    const percent = siteAssemblyPercent(s);
    const remaining = Math.max(0, expSum - asmSum);
    return {
      done: asmSum,
      target: Math.max(1, expSum),
      remaining,
      percent,
      noUpstreamTarget: false,
    };
  }

  if (sid === 6) {
    const target = ctx.requiredPackQty;
    const done = ctx.packedQty;
    const remaining = Math.max(0, target - done);
    const percent =
      target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
    return {
      done,
      target,
      remaining,
      percent,
      noUpstreamTarget: false,
    };
  }

  if (sid === 5) {
    const verified = doneRaw >= 1;
    const target = 1;
    const remaining = verified ? 0 : 1;
    return {
      done: doneRaw,
      target,
      remaining,
      percent: verified ? 100 : 0,
      noUpstreamTarget: false,
    };
  }

  const target = ctx.previousQty;
  const done = doneRaw;
  const remaining = Math.max(0, target - done);
  const percent =
    target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return {
    done,
    target,
    remaining,
    percent,
    noUpstreamTarget: sid >= 2 && sid <= 4 && target === 0,
  };
}

/** תחנה 1 תמיד פתוחה; תחנה k>1 רק אם כל התחנות 1..k-1 ב־100%. */
export function isStationUnlockedInChain(
  stationId: number,
  contextByStation: Partial<Record<number, WorkerContext>>,
): boolean {
  if (stationId <= 1) return true;
  for (let i = 1; i < stationId; i++) {
    const ctx = contextByStation[i];
    if (!ctx) return false;
    if (computeStationProgress(i, ctx).percent < 100) return false;
  }
  return true;
}
