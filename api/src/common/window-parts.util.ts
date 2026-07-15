/** Shared shape + normalizer for the window "parts mapping" (page-2 set tables). */

export interface WindowPartRowDto {
  partNumber: string;
  description: string;
  blockNumber: string;
}

export interface WindowPartSectionDto {
  key: string;
  title: string;
  rows: WindowPartRowDto[];
}

export interface WindowPartsDto {
  sections: WindowPartSectionDto[];
}

/**
 * Authoritative Hebrew descriptions for the standard window set tables.
 * These are the correct, canonical terms; OCR readings are snapped to them.
 */
const CANONICAL_DESCRIPTIONS = [
  // profiles
  'משקוף',
  'כנף',
  'מוט מוביל',
  // seals
  'אטם זיגוג פנימי',
  'אטם משקוף',
  'אטם כנף',
  'אטם חיצוני-מיוחד',
  // accessories
  'תושבת זכוכית',
  'פינת מתיחה',
  'פינת נעיצה/טרודה',
  'פין נעילה',
  'נגדי נעילה',
  'ידית לחלון',
  'מספריים לחלון',
  'מגביל פתיחה',
  'סט לתפיסת מספריים',
  'סט ברגים למגביל פתיחה',
  'מעביר תנועה',
  'פינה טרודה',
];

/** Normalize a Hebrew label for matching (strip quotes/geresh + collapse spaces). */
function normalizeHebKey(s: string): string {
  return s
    .replace(/["'\u05f3\u05f4]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Explicit OCR mis-reading → correct term map (keyed by normalized form).
 * Covers the specific errors reported from the field plus earlier glossary
 * variants, so descriptions are corrected statically and deterministically.
 */
const DESCRIPTION_CORRECTIONS: Record<string, string> = (() => {
  const pairs: [string, string][] = [
    // profiles
    ['נשפץ', 'משקוף'],
    ['גנף', 'כנף'],
    ['חסן מוביל', 'מוט מוביל'],
    ['חסן מולוך', 'מוט מוביל'],
    ['חסן מוליך', 'מוט מוביל'],
    // seals
    ['אטם דגמן פינתי', 'אטם זיגוג פנימי'],
    ['אטם דגמן פנימי', 'אטם זיגוג פנימי'],
    ['אטם גנף', 'אטם כנף'],
    ['אטם חיצוני-פנימי', 'אטם חיצוני-מיוחד'],
    ['אטם חיצוני-מרווח', 'אטם חיצוני-מיוחד'],
    // accessories
    ['פינת מיתרית', 'פינת מתיחה'],
    ['פינת מיתרה', 'פינת מתיחה'],
    ['פינת נשפץ/משקוף', 'פינת נעיצה/טרודה'],
    ['פינת נעיצה/מחזור', 'פינת נעיצה/טרודה'],
    ['פין עגולה', 'פין נעילה'],
    ['נגדי עגולה', 'נגדי נעילה'],
    ['סמפיירים לחלון', 'מספריים לחלון'],
    ['סמפיירים', 'מספריים לחלון'],
    ['מגביר פתיחה', 'מגביל פתיחה'],
    ['סט הרכבת מסילה', 'סט לתפיסת מספריים'],
    ['סט לחיצים מספריים', 'סט לתפיסת מספריים'],
    ['סט גגמים לתושבת פלסטי', 'סט ברגים למגביל פתיחה'],
    ['סט ברגים למגביר פתיחה', 'סט ברגים למגביל פתיחה'],
    ['משביר תושבת', 'מעביר תנועה'],
    ['פינה סרוקה', 'פינה טרודה'],
  ];
  const map: Record<string, string> = {};
  for (const [wrong, right] of pairs) map[normalizeHebKey(wrong)] = right;
  return map;
})();

/** Levenshtein edit distance (character-level). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Correct a single OCR'd part description: explicit correction map first, then
 * exact canonical match, then a conservative fuzzy snap to the nearest
 * canonical term. Falls back to the trimmed original when nothing is close.
 */
export function correctPartDescription(raw: string, fuzzy = false): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;
  const key = normalizeHebKey(trimmed);
  const mapped = DESCRIPTION_CORRECTIONS[key];
  if (mapped) return mapped;
  for (const canon of CANONICAL_DESCRIPTIONS) {
    if (normalizeHebKey(canon) === key) return canon;
  }
  // Fuzzy snapping only for raw OCR output — never for planner-entered text.
  if (!fuzzy) return trimmed;
  let best = '';
  let bestDist = Infinity;
  for (const canon of CANONICAL_DESCRIPTIONS) {
    const d = editDistance(normalizeHebKey(canon), key);
    if (d < bestDist) {
      bestDist = d;
      best = canon;
    }
  }
  // Snap only when the reading is clearly a close variant (<= ~1/3 of length).
  const threshold = Math.max(1, Math.floor(normalizeHebKey(best).length / 3));
  return best && bestDist <= threshold ? best : trimmed;
}

/** Coerce a stored partsPayload JSON value into the parts DTO (or null). */
export function normalizeWindowParts(payload: unknown): WindowPartsDto | null {
  const obj = (payload ?? null) as { sections?: unknown } | null;
  if (!obj || !Array.isArray(obj.sections)) return null;
  const sections = obj.sections
    .map((s) => {
      const sec = (s ?? {}) as { key?: unknown; title?: unknown; rows?: unknown };
      const rows = (Array.isArray(sec.rows) ? sec.rows : []).map((r) => {
        const row = (r ?? {}) as {
          partNumber?: unknown;
          description?: unknown;
          blockNumber?: unknown;
        };
        return {
          partNumber: row.partNumber == null ? '' : String(row.partNumber),
          description:
            row.description == null
              ? ''
              : correctPartDescription(String(row.description)),
          blockNumber: row.blockNumber == null ? '' : String(row.blockNumber),
        };
      });
      return {
        key: typeof sec.key === 'string' ? sec.key : 'OTHER',
        title: typeof sec.title === 'string' ? sec.title : '',
        rows,
      };
    })
    .filter((s) => s.rows.length > 0 || s.title.length > 0);
  return sections.length ? { sections } : null;
}

/** Sanitize an incoming (user-edited) parts payload for persistence. */
export function sanitizeWindowPartsInput(payload: unknown): WindowPartsDto {
  const normalized = normalizeWindowParts(payload);
  if (!normalized) return { sections: [] };
  // Trim strings and drop fully-empty rows.
  const sections = normalized.sections
    .map((s) => ({
      key: s.key,
      title: s.title.trim(),
      rows: s.rows
        .map((r) => ({
          partNumber: r.partNumber.trim(),
          description: r.description.trim(),
          blockNumber: r.blockNumber.trim(),
        }))
        .filter((r) => r.partNumber || r.description || r.blockNumber),
    }))
    .filter((s) => s.rows.length > 0);
  return { sections };
}
