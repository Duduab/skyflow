import {
  SiteAssemblyContext,
  WorkerContext,
} from '../../core/skyflow.models';
import { packPhotoRequiredCount } from './pack-photo.util';

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

/**
 * אחוז התקדמות ליעדי כמות גדולים (לייזר / ANG).
 * לא מעגל ל-0 כשיש דיווח — מציג עד עשירית האחוז, מינימום 0.1% כשבוצע > 0.
 */
export function highVolumeProgressPercent(
  done: number,
  target: number,
): number {
  if (target <= 0) return 0;
  if (done >= target) return 100;
  if (done <= 0) return 0;
  const raw = (done / target) * 100;
  if (raw < 10) {
    const tenths = Math.round(raw * 10) / 10;
    return Math.min(99.9, tenths > 0 ? tenths : 0.1);
  }
  return Math.min(100, Math.round(raw));
}

/** תווית אחוז לטבעת / פאנל — עשiriית מתחת ל-10%, אחרת מספר שלם */
export function formatProgressPercent(percent: number): string {
  if (percent <= 0) return '0';
  if (percent >= 100) return '100';
  if (percent < 10) {
    const s = percent.toFixed(1);
    return s.endsWith('.0') ? String(Math.round(percent)) : s;
  }
  return String(Math.round(percent));
}

/** אחוז לקשת SVG — מינימום 1% כשיש התקדמות, כדי שהטבעת תהיה נראית */
export function highVolumeProgressRingPercent(
  percent: number,
  done: number,
): number {
  if (done <= 0 || percent <= 0) return 0;
  if (percent >= 100) return 100;
  return percent < 1 ? 1 : percent;
}

function qtyAt(ctx: WorkerContext, stationId: number): number {
  return ctx.totals.find((t) => t.stationId === stationId)?.processedQty ?? 0;
}

/** לפחות דיווח מסורים אחד (מודאל TYPE) — פותח מעבר ל-CNC */
export function hasAnySawStationReport(ctx: WorkerContext): boolean {
  return sumSawWorkSawnByLine(ctx) > 0;
}

/** סכום פריטים שנוסרו לפי שורות תכנון (מודאל TYPE / לוגים) */
function sumSawWorkSawnByLine(ctx: WorkerContext): number {
  const m = ctx.sawWorkSawnByLineId;
  if (!m || typeof m !== 'object') return 0;
  return Object.values(m).reduce((s, v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return s + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  }, 0);
}

function sumWorkLineDoneByLine(ctx: WorkerContext): number {
  const m = ctx.workLineDoneByLineId;
  if (!m || typeof m !== 'object') return 0;
  return Object.values(m).reduce((s, v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return s + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  }, 0);
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
    const target =
      ctx.sawWorkTargetQty != null && ctx.sawWorkTargetQty > 0
        ? ctx.sawWorkTargetQty
        : ctx.order.totalItems;
    const barsDone = doneRaw;
    const piecesDone = sumSawWorkSawnByLine(ctx);
    /** יעד מתכנון (MPS/MPB) — התקדמות לפי סכום «נוסרו» לשורה, לא לפי processedQty בלבד */
    const usePlanningPieceProgress =
      (ctx.sawWorkLines?.length ?? 0) > 0 &&
      ctx.sawWorkTargetQty != null &&
      ctx.sawWorkTargetQty > 0;
    const done = usePlanningPieceProgress ? piecesDone : barsDone;
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
    const target =
      ctx.packReport?.requiredCount ??
      packPhotoRequiredCount(ctx.order.totalItems);
    const photos = ctx.packReport?.photos ?? [];
    let uploaded = 0;
    for (let i = 0; i < target; i++) {
      if (photos.some((p) => p.slotIndex === i)) uploaded++;
    }
    const remaining = Math.max(0, target - uploaded);
    const percent =
      target > 0 ? Math.min(100, Math.round((uploaded / target) * 100)) : 0;
    return {
      done: uploaded,
      target,
      remaining,
      percent,
      noUpstreamTarget: false,
    };
  }

  if (sid === 8) {
    const laser = ctx.laserStation;
    const target = Math.max(1, laser?.totalAngleQty ?? 0);
    const done = laser?.doneQty ?? 0;
    const remaining = Math.max(0, target - done);
    const percent = highVolumeProgressPercent(done, target);
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

  if (sid === 3 && ctx.assemblyStation) {
    const a = ctx.assemblyStation;
    if (a.typesReportTarget > 0) {
      const target = Math.max(1, a.typesReportTarget);
      const done = a.typesReportedCount;
      const remaining = Math.max(0, target - done);
      const percent = Math.min(100, Math.round((done / target) * 100));
      return {
        done,
        target,
        remaining,
        percent,
        noUpstreamTarget: false,
      };
    }
    if (a.windowsTotalQty > 0) {
      const target = Math.max(1, a.windowsTotalQty);
      const done = a.windowsAssembledQty;
      const remaining = Math.max(0, target - done);
      const percent = Math.min(100, Math.round((done / target) * 100));
      return {
        done,
        target,
        remaining,
        percent,
        noUpstreamTarget: false,
      };
    }
  }

  if (sid === 4 && (ctx.gluingStation?.typesWithGluing ?? 0) > 0) {
    const g = ctx.gluingStation!;
    const target = Math.max(1, g.typesWithGluing);
    const done = g.typesDone;
    const remaining = Math.max(0, target - done);
    const percent = Math.min(100, Math.round((done / target) * 100));
    return {
      done,
      target,
      remaining,
      percent,
      noUpstreamTarget: false,
    };
  }

  if (sid >= 2 && sid <= 4) {
    const target =
      ctx.sawWorkTargetQty != null && ctx.sawWorkTargetQty > 0
        ? ctx.sawWorkTargetQty
        : ctx.previousQty;
    const usePlanningLineProgress =
      (ctx.sawWorkLines?.length ?? 0) > 0 &&
      ctx.sawWorkTargetQty != null &&
      ctx.sawWorkTargetQty > 0;
    const done = usePlanningLineProgress
      ? sumWorkLineDoneByLine(ctx)
      : doneRaw;
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
    noUpstreamTarget: false,
  };
}

/**
 * תחנה 1 אחרי אישור תכנון.
 * תחנה 2 (CNC) נפתחת אחרי דיווח מסורים אחד לפחות — לא חייב 100% במסורים.
 * תחנות 3+ — כל התחנות הקודמות (מלבד מסורים) ב־100%.
 */
export function isStationUnlockedInChain(
  stationId: number,
  contextByStation: Partial<Record<number, WorkerContext>>,
): boolean {
  // אף תחנה לא נשארת נעולה: כל התחנות פתוחות ברגע שהתפ״י אושר (הפרויקט בייצור).
  // זרימת הפריטים בין התחנות נשמרת ברמת הפריט (למשל מוכנות TYPE להרכבה), לא בחסימת התחנה.
  void stationId;
  const flow = contextByStation[1]?.order.flowStatus ?? 'IN_PRODUCTION';
  return flow !== 'PENDING_PLANNING';
}
