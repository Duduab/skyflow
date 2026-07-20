/** Window/unit type code, e.g. 74-1-12A or 74-1-10. */
export const ELEVATION_WINDOW_CODE_RE = /^\d{2}-\d-\d{2}[A-Z]?$/;

/** Known Hebrew OCR misreads from elevation-map PDF text layers. */
const HEBREW_OCR_FIXES: Readonly<Record<string, string>> = {
  'ופנדרל': 'ספנדרל',
  'לרדנפו': 'ספנדרל',
  'לרדנפס': 'ספנדרל',
  'קלוע': 'קבוע',
  'עולק': 'קבוע',
};

/** Fix common elevation-map Hebrew OCR mistakes after RTL correction. */
export function fixElevationHebrewOcr(s: string): string {
  const t = s.trim();
  if (HEBREW_OCR_FIXES[t]) return HEBREW_OCR_FIXES[t];
  if (/^[וו]?פנדרל$/.test(t)) return 'ספנדרל';
  if (/^קלוע$/.test(t)) return 'קבוע';
  return t;
}

/** PSI labels and red-circle mark numbers that should not appear in item lists. */
export function isElevationNoiseItem(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^\d+\s*psi$/i.test(t) || /^psi\s*\d+$/i.test(t)) return true;
  if (/^\d{1,3}$/.test(t)) return true;
  if (/^[+\-]?\d{1,3}\.\d{2}$/.test(t)) return true;
  return false;
}

export function normalizeElevationItemText(s: string): string {
  return fixElevationHebrewOcr(s);
}

/** Normalize and drop annotation noise from a cell's PDF text items. */
export function filterElevationItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const normalized = normalizeElevationItemText(raw);
    if (!normalized || isElevationNoiseItem(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
