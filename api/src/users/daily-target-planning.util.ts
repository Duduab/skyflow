export type StoredDailyTargetLineItem = {
  sortOrder: number;
  description: string;
  profileCode: string | null;
  cutLengthMm: number | null;
  instructionKind: string;
  targetQty: number;
};

export type PlanningSawLineInput = {
  description: string;
  quantity: number;
  sawsProfileCode: string | null;
  planningCutLengthMm: number | null;
  instructionKind: string;
  sortOrder: number;
};

/** חלוקה שווה של כמות בין N משתתפים (שארית מתחלקת לראשונים) */
export function splitQtyEvenly(total: number, participants: number): number[] {
  if (participants <= 0) return [];
  const safeTotal = Math.max(0, Math.floor(total));
  const base = Math.floor(safeTotal / participants);
  const remainder = safeTotal % participants;
  return Array.from({ length: participants }, (_, i) =>
    base + (i < remainder ? 1 : 0),
  );
}

export function manualDailyTargetDedupeKey(
  userId: string,
  targetDate: string,
): string {
  return `${userId}:${targetDate}:manual`;
}

export function planningDailyTargetDedupeKey(
  userId: string,
  targetDate: string,
  projectId: string,
  stationId: number,
): string {
  return `${userId}:${targetDate}:${projectId}:${stationId}`;
}

export function buildPlanningTargetDescription(
  projectName: string,
  stationName: string,
  qty: number,
): string {
  return `${projectName.trim()} — ${stationName} — ${qty} יח׳`;
}

/** הערכת זמן יעד לפי כמות (דקות) */
export function estimatePlanningTargetMinutes(qty: number): number {
  if (qty <= 0) return 30;
  return Math.max(30, Math.min(qty * 8, 8 * 60));
}

export function buildWorkerLineItems(
  sawLines: PlanningSawLineInput[],
  assigneeIndex: number,
  assigneeCount: number,
): StoredDailyTargetLineItem[] {
  if (assigneeCount <= 0 || assigneeIndex < 0) return [];

  return sawLines
    .map((line) => {
      const shares = splitQtyEvenly(line.quantity, assigneeCount);
      const targetQty = shares[assigneeIndex] ?? 0;
      return {
        sortOrder: line.sortOrder,
        description: line.description.trim(),
        profileCode: line.sawsProfileCode,
        cutLengthMm: line.planningCutLengthMm,
        instructionKind: line.instructionKind,
        targetQty,
      };
    })
    .filter((row) => row.targetQty > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
