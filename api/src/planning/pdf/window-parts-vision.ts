import { createCanvas, type Canvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type Anthropic from '@anthropic-ai/sdk';
import { correctPartDescription } from '../../common/window-parts.util';
import { mapWithConcurrency } from '../../common/concurrency.util';

/** Max simultaneous Claude calls per page's image set (full page + tiles). */
const VISION_CONCURRENCY = 3;

/**
 * Reads the "set" tables (profiles / seals / accessories) from the window
 * instruction sheet using Claude vision. Those tables are a raster drawing
 * (no PDF text layer), so plain text extraction returns nothing.
 *
 * Hebrew descriptions inside tiny table cells are easy to misread when a whole
 * sheet is squeezed into one small image (the model then "phonetically" guesses
 * — e.g. משקוף → נשפץ). To be accurate we:
 *   1. render each page to a HIGH-RES master and send it as overlapping crops
 *      (tiles), each near the model's sweet spot, so every cell is crisp;
 *   2. give the model the real domain vocabulary (standard aluminium-window
 *      hardware terms) so it snaps to correct words instead of guessing;
 *   3. read every image and MAJORITY-VOTE each row across images, keyed by the
 *      catalog number (which OCRs reliably), so a single misread is outvoted.
 */

/** Long side (px) of the high-res master render that crops are cut from. */
const MASTER_LONG_SIDE = 3400;
/** Long side (px) any single image is downscaled to before sending. */
const SEND_LONG_SIDE = 1560;
const TILE_COLS = 2;
const TILE_ROWS = 2;
const TILE_OVERLAP = 0.16;

export type WindowPartSectionKey =
  | 'PROFILES'
  | 'SEALS'
  | 'ACCESSORIES'
  | 'SHOKONIM_MOUNTS'
  | 'OTHER';

export interface WindowPartRow {
  /** מק״ט — catalog / part number, e.g. "48503". */
  partNumber: string;
  /** אביזר — short description, e.g. "משקוף". */
  description: string;
  /** מספר בלוק — block number, e.g. "1". */
  blockNumber: string;
}

export interface WindowPartSection {
  key: WindowPartSectionKey;
  /** Hebrew title as printed, e.g. "סט לחלון – פרופילים". */
  title: string;
  rows: WindowPartRow[];
}

export interface WindowPartsMapping {
  sections: WindowPartSection[];
}

const SECTION_BY_HINT: { re: RegExp; key: WindowPartSectionKey }[] = [
  { re: /פרופיל/, key: 'PROFILES' },
  { re: /אטמ|אטם/, key: 'SEALS' },
  { re: /אביזר/, key: 'ACCESSORIES' },
  { re: /שוקונ|תושב/, key: 'SHOKONIM_MOUNTS' },
];

function classifySection(title: string): WindowPartSectionKey {
  for (const hint of SECTION_BY_HINT) {
    if (hint.re.test(title)) return hint.key;
  }
  return 'OTHER';
}

/** Clean, consistent Hebrew title per section (OCR titles pick up stray notes). */
const CANONICAL_TITLES: Record<WindowPartSectionKey, string> = {
  PROFILES: 'סט לחלון - פרופילים',
  SEALS: 'סט לחלון - אטמים',
  ACCESSORIES: 'סט לחלון - אביזרים',
  SHOKONIM_MOUNTS: 'סט שוקונים + תושבות לזכוכית',
  OTHER: '',
};

function canonicalTitle(key: WindowPartSectionKey, ocrTitles: string[]): string {
  return CANONICAL_TITLES[key] || majority(ocrTitles);
}

/** Render one PDF page to a high-res master canvas. */
async function renderMasterCanvas(page: pdfjs.PDFPageProxy): Promise<Canvas> {
  const base = page.getViewport({ scale: 1 });
  const longSide = Math.max(base.width, base.height);
  const scale = Math.min(4, Math.max(1, MASTER_LONG_SIDE / longSide));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const ctx = canvas.getContext('2d');
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  return canvas;
}

/** Crop a region of the master and export as base64 PNG, downscaled to fit. */
function exportCrop(
  master: Canvas,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): string {
  const longSide = Math.max(sw, sh);
  const scale = Math.min(1, SEND_LONG_SIDE / longSide);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const out = createCanvas(dw, dh);
  const ctx = out.getContext('2d');
  ctx.drawImage(
    master as unknown as import('@napi-rs/canvas').Image,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    dw,
    dh,
  );
  return out.toBuffer('image/png').toString('base64');
}

/** Full page + overlapping tiles, so every cell is legible in at least one image. */
function buildPageImageSet(master: Canvas): string[] {
  const W = master.width;
  const H = master.height;
  const images: string[] = [exportCrop(master, 0, 0, W, H)];
  const tileW = Math.ceil(W / TILE_COLS);
  const tileH = Math.ceil(H / TILE_ROWS);
  const ovX = Math.round(tileW * TILE_OVERLAP);
  const ovY = Math.round(tileH * TILE_OVERLAP);
  for (let r = 0; r < TILE_ROWS; r += 1) {
    for (let c = 0; c < TILE_COLS; c += 1) {
      const sx = Math.max(0, c * tileW - ovX);
      const sy = Math.max(0, r * tileH - ovY);
      const sw = Math.min(W - sx, tileW + ovX * 2);
      const sh = Math.min(H - sy, tileH + ovY * 2);
      images.push(exportCrop(master, sx, sy, sw, sh));
    }
  }
  return images;
}

/**
 * Standard aluminium-window hardware vocabulary that appears in these set
 * tables. Giving the model the real words prevents phonetic guesses.
 */
const GLOSSARY = [
  // profiles
  'משקוף',
  'כנף',
  'מוט מוביל',
  // seals
  'אטם זיגוג פנימי',
  'אטם משקוף',
  'אטם כנף',
  'אטם חיצוני-מרווח',
  'אטם חיצוני-פנימי',
  'רוכסן דגמן עגול',
  'שפת הדבקה',
  // accessories
  'תושבת זכוכית',
  'פינת מיתרה',
  'פינת נעיצה/מחזור',
  'פין נעילה',
  'נגדי נעילה',
  'ידית לחלון',
  'מספריים לחלון',
  'מגביר פתיחה',
  'סט לחיצים מספריים',
  'סט ברגים למגביר פתיחה',
  'מעביר תנועה',
  'פינה טרודה',
];

const SYSTEM_PROMPT =
  'You are a meticulous OCR engine for Hebrew aluminium/steel window ' +
  'production-instruction "set" tables (right-to-left). A sheet contains one or ' +
  'more tables titled like "סט לחלון - פרופילים" (profiles), ' +
  '"סט לחלון - אטמים" (seals/gaskets), "סט לחלון - אביזרים" (accessories), or ' +
  '"סט שוקונים + תושבות לזכוכית". Each table has 4 columns; right-to-left they are: ' +
  '"מספר בלוק" (block number — a small integer, sometimes a merged cell spanning ' +
  'two rows), "אביזר" (Hebrew item/part name), a sketch column (IGNORE the drawing), ' +
  'and "מק״ט" (catalog/part number: usually 4-7 characters, digits, sometimes with ' +
  'a slash or asterisks, e.g. "206251/1092", "2022**").\n\n' +
  'ACCURACY RULES (critical):\n' +
  '1. Read the EXACT Hebrew letters of each "אביזר" cell. Do NOT guess phonetically ' +
  'and do NOT swap similar letters (e.g. never read משקוף as נשפץ, or כנף as גנף).\n' +
  '2. The item names are standard hardware terms. Prefer these known terms when they ' +
  'match what you see: ' +
  GLOSSARY.join(', ') +
  '.\n' +
  '3. The "מק״ט" catalog number is NUMERIC: it consists only of digits 0-9, ' +
  'optionally with a slash "/" or asterisks "*" (e.g. "55501", "206251/1092", ' +
  '"2022**"). It NEVER contains Latin letters. If a character looks like a letter ' +
  '(p, b, o, O, l, I, S, g, Z, B) it is actually the matching digit — read it as a ' +
  'digit. Some rows have a Hebrew note instead of a number in that column; only ' +
  'return an actual numeric catalog number, otherwise leave partNumber empty.\n' +
  '4. If a "מספר בלוק" cell is merged across several rows, repeat that same block ' +
  'number on every row it spans (do not leave it empty).\n' +
  '5. Do NOT invent, merge, drop, or reorder rows. One JSON row per table row.\n\n' +
  'Return ONLY compact JSON of this exact shape, no prose:\n' +
  '{"sections":[{"title":"<hebrew title as printed>","rows":[' +
  '{"partNumber":"<מק״ט>","description":"<אביזר>","blockNumber":"<מספר בלוק>"}]}]}';

function parseMapping(text: string): { title: string; rows: WindowPartRow[] }[] {
  if (!text) return [];
  let raw: unknown;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    raw = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return [];
  }
  const obj = (raw ?? {}) as { sections?: unknown };
  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const out: { title: string; rows: WindowPartRow[] }[] = [];
  for (const s of sectionsRaw) {
    const sec = (s ?? {}) as { title?: unknown; rows?: unknown };
    const title = typeof sec.title === 'string' ? sec.title.trim() : '';
    const rowsRaw = Array.isArray(sec.rows) ? sec.rows : [];
    const rows: WindowPartRow[] = [];
    for (const r of rowsRaw) {
      const row = (r ?? {}) as {
        partNumber?: unknown;
        description?: unknown;
        blockNumber?: unknown;
      };
      const partNumber =
        row.partNumber == null ? '' : String(row.partNumber).trim();
      const description =
        row.description == null ? '' : String(row.description).trim();
      const blockNumber =
        row.blockNumber == null ? '' : String(row.blockNumber).trim();
      if (!partNumber && !description) continue;
      rows.push({ partNumber, description, blockNumber });
    }
    if (!title && !rows.length) continue;
    out.push({ title, rows });
  }
  return out;
}

/**
 * Catalog numbers are numeric (digits + optional "/" and "*"). Normalize an OCR
 * reading: drop Hebrew notes (not a real מק״ט) and map look-alike Latin letters
 * back to digits. Returns '' when the token isn't a plausible catalog number.
 */
const LETTER_TO_DIGIT: Record<string, string> = {
  o: '0',
  O: '0',
  l: '1',
  I: '1',
  i: '1',
  S: '5',
  s: '5',
  b: '6',
  B: '8',
  g: '9',
  q: '9',
  Z: '2',
  z: '2',
  p: '9',
};

function cleanPartNumber(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/[\u0590-\u05FF]/.test(t)) return ''; // Hebrew note, not a catalog number
  const mapped = t
    .split('')
    .map((ch) => LETTER_TO_DIGIT[ch] ?? ch)
    .join('')
    .replace(/\s+/g, '');
  // Keep only plausible catalog tokens: digits with optional / and *
  if (!/^[0-9/*]+$/.test(mapped)) return '';
  return mapped;
}

/** Most frequent non-empty value; ties resolved by first occurrence. */
function majority(values: string[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    if (!counts.has(t)) order.push(t);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const v of order) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

interface RowAgg {
  description: string;
  blockNumber: string;
  /** catalog numbers read across images — majority-voted at the end */
  parts: string[];
  order: number;
}

interface SectionAgg {
  titles: string[];
  rows: Map<string, RowAgg>;
  order: number;
}

async function detectSectionsOnImage(
  pngBase64: string,
  anthropic: Anthropic,
  model: string,
): Promise<{ title: string; rows: WindowPartRow[] }[]> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 3000,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: pngBase64,
            },
          },
          {
            type: 'text',
            text:
              'Extract every set table visible in this image as JSON. Read each ' +
              'Hebrew "אביזר" cell letter-by-letter and copy each "מק״ט" exactly.',
          },
        ],
      },
    ],
  });
  const text = res.content
    .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
    .join('\n')
    .trim();
  return parseMapping(text);
}

/**
 * Extract the set/part tables from the given PDF pages (0-based indices),
 * majority-voting each row across a full-page view + high-res crops.
 */
export async function extractWindowPartsFromPdf(
  buffer: Buffer,
  pageIndices: number[],
  anthropic: Anthropic,
  model: string,
): Promise<WindowPartsMapping> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const wanted = [...new Set(pageIndices)]
      .filter((i) => i >= 0 && i < doc.numPages)
      .sort((a, b) => a - b);

    // Aggregate every reading, keyed by section then by catalog number.
    const sections = new Map<WindowPartSectionKey, SectionAgg>();
    let sectionOrder = 0;

    for (const pageIndex of wanted) {
      const page = await doc.getPage(pageIndex + 1);
      const master = await renderMasterCanvas(page);
      const images = buildPageImageSet(master);
      // Each image (full page + tiles) is an independent Claude call — run
      // them with bounded concurrency instead of one after another.
      const perImageResults = await mapWithConcurrency(
        images,
        VISION_CONCURRENCY,
        async (img) => {
          try {
            return await detectSectionsOnImage(img, anthropic, model);
          } catch {
            return []; // one failed crop shouldn't sink the rest
          }
        },
      );
      for (const parsed of perImageResults) {
        for (const sec of parsed) {
          const key = classifySection(sec.title);
          let agg = sections.get(key);
          if (!agg) {
            agg = { titles: [], rows: new Map(), order: sectionOrder++ };
            sections.set(key, agg);
          }
          if (sec.title) agg.titles.push(sec.title);
          let idx = 0;
          for (const rawRow of sec.rows) {
            // Correct/canonicalize the description up-front so mis-read variants
            // (e.g. "נשפץ" vs "משקוף") collapse to the same row when merging.
            const row = {
              ...rawRow,
              description: correctPartDescription(rawRow.description, true),
            };
            // Row identity is the Hebrew description + block number (both read
            // reliably now); the catalog number is what varies between crops,
            // so we vote on it rather than key by it (avoids duplicate rows).
            const rowKey = row.description
              ? `${row.description}##${row.blockNumber}`
              : `p:${row.partNumber}`;
            let ra = agg.rows.get(rowKey);
            if (!ra) {
              ra = {
                description: row.description,
                blockNumber: row.blockNumber,
                parts: [],
                order: idx,
              };
              agg.rows.set(rowKey, ra);
            } else {
              ra.order = Math.min(ra.order, idx);
              if (!ra.blockNumber && row.blockNumber) {
                ra.blockNumber = row.blockNumber;
              }
            }
            const cleanedPart = cleanPartNumber(row.partNumber);
            if (cleanedPart) ra.parts.push(cleanedPart);
            idx += 1;
          }
        }
      }
    }

    // Reduce aggregates to a clean, ordered mapping via majority vote.
    const orderedKeys = [...sections.entries()].sort(
      (a, b) => a[1].order - b[1].order,
    );
    const result: WindowPartSection[] = [];
    for (const [key, agg] of orderedKeys) {
      const rows: (WindowPartRow & { _order: number })[] = [];
      for (const ra of agg.rows.values()) {
        rows.push({
          partNumber: majority(ra.parts),
          description: ra.description,
          blockNumber: ra.blockNumber,
          _order: ra.order,
        });
      }
      if (!rows.length) continue;
      rows.sort((a, b) => {
        const ba = Number(a.blockNumber);
        const bb = Number(b.blockNumber);
        const aNum = Number.isFinite(ba) && a.blockNumber !== '';
        const bNum = Number.isFinite(bb) && b.blockNumber !== '';
        if (aNum && bNum && ba !== bb) return ba - bb;
        return a._order - b._order;
      });
      result.push({
        key,
        title: canonicalTitle(key, agg.titles),
        rows: rows.map(({ _order, ...r }) => r),
      });
    }
    return { sections: result };
  } finally {
    await doc.destroy();
  }
}
