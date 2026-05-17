/**
 * ערך תא מהתכנון (למשל 890) — נשמר ב־ProductComponent.spec כמחרוזת.
 * מתפרש כאורך חיתוך ב־סנטימטרים לשורת מסור.
 */
export function planningCutLengthCmFromSpec(
  spec: string | null | undefined,
): number | null {
  if (spec == null) return null;
  const t = String(spec).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  /** חיתוך עד ~30 מ׳ — מגן מפני טעות יחידות */
  if (n > 60000) return null;
  return Math.round(n);
}
