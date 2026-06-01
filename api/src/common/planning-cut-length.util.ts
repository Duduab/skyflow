/**
 * ערך תא מהתכנון (למשל 6200) — נשמר ב־ProductComponent.spec כמחרוזת.
 * מתפרש כאורך חיתוך ב־מילימטרים לשורת מסור.
 */
export function planningCutLengthMmFromSpec(
  spec: string | null | undefined,
): number | null {
  if (spec == null) return null;
  const t = String(spec).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  /** חיתוך עד ~60 מ׳ — מגן מפני טעות יחידות */
  if (n > 600000) return null;
  return Math.round(n);
}
