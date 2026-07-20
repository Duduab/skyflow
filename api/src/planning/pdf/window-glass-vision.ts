import { createCanvas, type Canvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Detects the GLASS panels of a window unit from its instruction sheet so the
 * gluing station can show the actual glass rectangles that must be glued.
 *
 * The colored front-elevation drawing (titled "ALUM. RAL …") paints glass in
 * cyan/turquoise and opaque spandrel panels in gray. Glass panels carry codes
 * like "WM-1" (window/openable) or "GM-1"/"GM-2" (fixed glazing); spandrel
 * panels carry "SP-*" and are NOT glass.
 *
 * The codes + layout are a raster drawing (no PDF text layer), so we:
 *   1. render the drawing page to a high-res master,
 *   2. ask Claude vision for each glass panel's code, kind and rough bbox,
 *   3. tighten each bbox to the actual cyan region with a deterministic pixel
 *      scan (fixes vision's imprecision — no extra model cost),
 *   4. crop the tight rectangle to a PNG the station can display.
 */

const MASTER_LONG_SIDE = 3200;
/** Long side any single crop is downscaled to before it is stored/displayed. */
const CROP_LONG_SIDE = 900;
/** Long side the full page is downscaled to before sending to the model. */
const SEND_LONG_SIDE = 1560;

export type GlassKind = 'WINDOW' | 'FIXED';

export interface GlassElement {
  /** Panel code as printed, e.g. "WM-1", "GM-2". */
  code: string;
  /** WINDOW = openable window glass, FIXED = fixed glazing. */
  kind: GlassKind;
  /** Cropped rectangle of the glass panel, base64 PNG. */
  pngBase64: string;
  /** Reading order top-to-bottom (0-based). */
  order: number;
}

export interface WindowDrawingExtraction {
  glass: GlassElement[];
  /** Elevation stack top-to-bottom: SPANDREL | WINDOW | FIXED | SHADOW_BOX. */
  compositionTopDown: string[];
}

interface VisionGlass {
  code: string;
  kind: GlassKind;
  /** normalized [0..1] bbox on the full page */
  x: number;
  y: number;
  w: number;
  h: number;
}

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

function exportFullPage(master: Canvas): string {
  const longSide = Math.max(master.width, master.height);
  const scale = Math.min(1, SEND_LONG_SIDE / longSide);
  const dw = Math.max(1, Math.round(master.width * scale));
  const dh = Math.max(1, Math.round(master.height * scale));
  const out = createCanvas(dw, dh);
  const ctx = out.getContext('2d');
  ctx.drawImage(
    master as unknown as import('@napi-rs/canvas').Image,
    0,
    0,
    master.width,
    master.height,
    0,
    0,
    dw,
    dh,
  );
  return out.toBuffer('image/png').toString('base64');
}

function cropToBase64(
  master: Canvas,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): string {
  const longSide = Math.max(sw, sh);
  const scale = Math.min(1, CROP_LONG_SIDE / longSide);
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

/** True for the turquoise/cyan glass fill (high blue+green, low red, saturated). */
function isGlassCyan(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 70) return false; // too dark (line / glyph)
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.18) return false; // gray spandrel / white background
  // cyan: blue and green dominate red
  return b >= r + 25 && g >= r + 10 && b > 90;
}

/**
 * Tighten a rough (vision) bbox to the actual cyan glass panel. Panels are
 * stacked with thin gray separators, so a plain min/max of cyan pixels would
 * bleed into the neighbours above/below. Instead we GROW outward from the box
 * centre one row/column at a time and STOP at the first gray gap (a line whose
 * cyan coverage collapses) — which is exactly the panel boundary.
 * Falls back to the original box when the region can't be found.
 */
const STEP = 2;

function refineToCyanRegion(
  master: Canvas,
  gx: number,
  gy: number,
  gw: number,
  gh: number,
): { x: number; y: number; w: number; h: number } {
  const ctx = master.getContext('2d');
  // scan window: allow growth up to ~55% of the box beyond each edge
  const marginX = Math.round(gw * 0.55);
  const marginY = Math.round(gh * 0.55);
  const x0 = Math.max(0, Math.floor(gx - marginX));
  const y0 = Math.max(0, Math.floor(gy - marginY));
  const x1 = Math.min(master.width, Math.ceil(gx + gw + marginX));
  const y1 = Math.min(master.height, Math.ceil(gy + gh + marginY));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 4 || h <= 4) return { x: gx, y: gy, w: gw, h: gh };

  const data = ctx.getImageData(x0, y0, w, h).data;
  const cols = Math.floor(w / STEP);
  const rows = Math.floor(h / STEP);
  const cyan = (ci: number, rj: number): boolean => {
    const px = ci * STEP;
    const py = rj * STEP;
    const i = (py * w + px) * 4;
    return isGlassCyan(data[i], data[i + 1], data[i + 2]);
  };

  // vision box in cell coordinates
  const bxa = Math.max(0, Math.round((gx - x0) / STEP));
  const bxb = Math.min(cols - 1, Math.round((gx + gw - x0) / STEP));
  const bya = Math.max(0, Math.round((gy - y0) / STEP));
  const byb = Math.min(rows - 1, Math.round((gy + gh - y0) / STEP));
  if (bxb <= bxa || byb <= bya) return { x: gx, y: gy, w: gw, h: gh };

  const rowCyan = (rj: number): number => {
    let c = 0;
    for (let ci = bxa; ci <= bxb; ci += 1) if (cyan(ci, rj)) c += 1;
    return c;
  };
  const rowThresh = Math.max(2, (bxb - bxa) * 0.35);

  // pick a solid starting row near the box centre
  let cy = Math.round((bya + byb) / 2);
  if (rowCyan(cy) < rowThresh) {
    let found = -1;
    for (let d = 1; d < rows && found < 0; d += 1) {
      if (cy - d >= 0 && rowCyan(cy - d) >= rowThresh) found = cy - d;
      else if (cy + d < rows && rowCyan(cy + d) >= rowThresh) found = cy + d;
    }
    if (found < 0) return { x: gx, y: gy, w: gw, h: gh };
    cy = found;
  }
  let top = cy;
  while (top > 0 && rowCyan(top - 1) >= rowThresh) top -= 1;
  let bot = cy;
  while (bot < rows - 1 && rowCyan(bot + 1) >= rowThresh) bot += 1;

  const colCyan = (ci: number): number => {
    let c = 0;
    for (let rj = top; rj <= bot; rj += 1) if (cyan(ci, rj)) c += 1;
    return c;
  };
  const colThresh = Math.max(2, (bot - top) * 0.35);
  let cx = Math.round((bxa + bxb) / 2);
  if (colCyan(cx) < colThresh) {
    let found = -1;
    for (let d = 1; d < cols && found < 0; d += 1) {
      if (cx - d >= 0 && colCyan(cx - d) >= colThresh) found = cx - d;
      else if (cx + d < cols && colCyan(cx + d) >= colThresh) found = cx + d;
    }
    if (found >= 0) cx = found;
  }
  let left = cx;
  while (left > 0 && colCyan(left - 1) >= colThresh) left -= 1;
  let right = cx;
  while (right < cols - 1 && colCyan(right + 1) >= colThresh) right += 1;

  // back to pixels with a small pad so the pane frame is included
  const pad = 4;
  const rx = Math.max(0, x0 + left * STEP - pad);
  const ry = Math.max(0, y0 + top * STEP - pad);
  const rw = Math.min(master.width - rx, (right - left) * STEP + pad * 2);
  const rh = Math.min(master.height - ry, (bot - top) * STEP + pad * 2);
  if (rw <= 4 || rh <= 4) return { x: gx, y: gy, w: gw, h: gh };
  return { x: rx, y: ry, w: rw, h: rh };
}

const SYSTEM_PROMPT =
  'You analyze an aluminium/steel window production-instruction sheet. It has a ' +
  'colored FRONT-ELEVATION drawing (its column/title contains "ALUM. RAL"). In ' +
  'that elevation, GLASS panels are painted turquoise/cyan and each carries a ' +
  'code label. Opaque SPANDREL panels are gray and carry "SP-*" codes — those ' +
  'are NOT glass and must be ignored for glass[]. Codes look like "WM-1" ' +
  '(openable WINDOW, glazed) or "GM-1", "GM-2" (FIXED glazing). Report EVERY ' +
  'glass panel (every WM-* and GM-*), ordered top-to-bottom as drawn.\n\n' +
  'Also read the full vertical stack of horizontal bands in that elevation ' +
  '(top to bottom, ignore CORNER ANGLE headers). For each band return one of: ' +
  '"SPANDREL" (gray opaque / SP-* / Hebrew ספנדרל), "WINDOW" (openable WM-* or ' +
  'Hebrew חלון), "FIXED" (fixed GM-* or Hebrew קבוע), "SHADOW_BOX" (Shadow Box ' +
  'label if present). Include repeated bands.\n\n' +
  'For each glass panel return: its exact code; kind = "WINDOW" when the code ' +
  'starts with WM (openable), "FIXED" when it starts with GM (fixed glazing); ' +
  'and a tight bounding box of the cyan panel as fractions of the FULL image ' +
  'width/height (x,y = top-left; w,h = size; all in 0..1).\n\n' +
  'Return ONLY compact JSON, no prose:\n' +
  '{"composition":["SPANDREL","WINDOW","FIXED"],' +
  '"glass":[{"code":"WM-1","kind":"WINDOW","x":0.0,"y":0.0,"w":0.0,"h":0.0}]}';

const COMPOSITION_LABELS = new Set([
  'SPANDREL',
  'WINDOW',
  'FIXED',
  'SHADOW_BOX',
]);

function normalizeCompositionLabel(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const u = s.toUpperCase().replace(/\s+/g, '_');
  if (COMPOSITION_LABELS.has(u)) return u;
  if (/SPANDREL|SP-\d|ספנדרל/.test(s)) return 'SPANDREL';
  if (/SHADOW/.test(u)) return 'SHADOW_BOX';
  if (/WINDOW|WM-|חלון/.test(s)) return 'WINDOW';
  if (/FIXED|GM-|קבוע/.test(s)) return 'FIXED';
  return null;
}

function parseVision(text: string): { glass: VisionGlass[]; composition: string[] } {
  if (!text) return { glass: [], composition: [] };
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { glass: [], composition: [] };
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  const composition: string[] = [];
  if (Array.isArray(obj['composition'])) {
    for (const item of obj['composition']) {
      if (typeof item !== 'string') continue;
      const label = normalizeCompositionLabel(item);
      if (label) composition.push(label);
    }
  }
  const arr = obj['glass'];
  const out: VisionGlass[] = [];
  if (!Array.isArray(arr)) return { glass: out, composition };
  for (const g of arr) {
    const o = (g ?? {}) as Record<string, unknown>;
    const code = typeof o['code'] === 'string' ? o['code'].trim() : '';
    if (!/^(WM|GM)-/i.test(code)) continue;
    const kind: GlassKind = /^WM-/i.test(code) ? 'WINDOW' : 'FIXED';
    const num = (k: string): number => {
      const v = Number(o[k]);
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    };
    out.push({
      code: code.toUpperCase(),
      kind,
      x: num('x'),
      y: num('y'),
      w: num('w'),
      h: num('h'),
    });
  }
  return { glass: out, composition };
}

/**
 * Extract glass panels (crops + code + kind) from the window's drawing page.
 * `drawingPage` is the 0-based page index that holds the colored elevation.
 */
export async function extractWindowGlassFromPdf(
  buffer: Buffer,
  drawingPage: number,
  anthropic: Anthropic,
  model: string,
): Promise<WindowDrawingExtraction> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    if (drawingPage < 0 || drawingPage >= doc.numPages) {
      return { glass: [], compositionTopDown: [] };
    }
    const page = await doc.getPage(drawingPage + 1);
    const master = await renderMasterCanvas(page);
    const fullPage = exportFullPage(master);

    const res = await anthropic.messages.create({
      model,
      max_tokens: 2000,
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
                data: fullPage,
              },
            },
            {
              type: 'text',
              text:
                'Read the ALUM.RAL colored elevation: return the full vertical ' +
                'composition stack (top-to-bottom) and every glass panel (WM-* / ' +
                'GM-*) with code, kind and tight cyan bounding box.',
            },
          ],
        },
      ],
    });
    const text = res.content
      .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
      .join('\n')
      .trim();

    const parsed = parseVision(text);
    // de-dupe by code, keep drawing order (top-to-bottom by y)
    const byCode = new Map<string, VisionGlass>();
    for (const g of parsed.glass) if (!byCode.has(g.code)) byCode.set(g.code, g);
    const ordered = [...byCode.values()].sort((a, b) => a.y - b.y);

    const out: GlassElement[] = [];
    let order = 0;
    for (const g of ordered) {
      const gx = g.x * master.width;
      const gy = g.y * master.height;
      const gw = Math.max(8, g.w * master.width);
      const gh = Math.max(8, g.h * master.height);
      const box = refineToCyanRegion(master, gx, gy, gw, gh);
      const pngBase64 = cropToBase64(master, box.x, box.y, box.w, box.h);
      out.push({ code: g.code, kind: g.kind, pngBase64, order: order++ });
    }
    return { glass: out, compositionTopDown: parsed.composition };
  } finally {
    await doc.destroy();
  }
}
