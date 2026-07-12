import { createCanvas, type Canvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Reads ANG angle codes from the window-instruction drawings using Claude vision.
 * The ANG labels live inside the drawing (vector/image), not the PDF text layer,
 * so a plain text scan misses them — vision is required.
 *
 * Small callouts (e.g. an "ANG-3" on the bottom sill, printed over a gray block)
 * are easy to miss when a whole A2/A3 sheet is squeezed into one image, because
 * the API downscales large images to ~1568px on the long side. To keep every
 * label crisp we render each page to a high-res master, then send it as
 * overlapping crops (tiles) that are each near that size, and union the codes
 * found across all crops. A full-page pass is included for context/dedup.
 */

const MAX_PAGES = 40;
/** Long side (px) of the high-res master render that crops are cut from. */
const MASTER_LONG_SIDE = 3600;
/** Long side (px) any single image is downscaled to before sending (Claude's sweet spot). */
const SEND_LONG_SIDE = 1560;
/** Crop grid + fractional overlap so a label on a seam is never cut in half. */
const TILE_COLS = 2;
const TILE_ROWS = 2;
const TILE_OVERLAP = 0.14;

const ANG_VALID_RE = /^ANG-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** Render one PDF page to a high-res master canvas. */
async function renderMasterCanvas(
  page: pdfjs.PDFPageProxy,
): Promise<Canvas> {
  const base = page.getViewport({ scale: 1 });
  const longSide = Math.max(base.width, base.height);
  // Scale toward MASTER_LONG_SIDE (up for small sheets, keep large ones large); cap at 4x.
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

/** Crop a region of the master and export it as base64 PNG, downscaled to SEND_LONG_SIDE. */
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

/** Build the set of images sent for one page: a full-page view + overlapping crops. */
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
 * Render selected pages to high-res image sets (full page + overlapping crops).
 * Returns a map of 0-based page index → base64 PNG images for that page.
 */
export async function renderPdfPageImageSets(
  buffer: Buffer,
  pageIndices: Set<number>,
): Promise<Map<number, string[]>> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const out = new Map<number, string[]>();
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (const pageIndex of [...pageIndices].sort((a, b) => a - b)) {
      if (pageIndex < 0 || pageIndex >= count) continue;
      const page = await doc.getPage(pageIndex + 1);
      const master = await renderMasterCanvas(page);
      out.set(pageIndex, buildPageImageSet(master));
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Ask Claude to list every ANG code visible in one image (full page or crop). */
async function detectAnglesOnImage(
  pngBase64: string,
  anthropic: Anthropic,
  model: string,
): Promise<string[]> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 500,
    temperature: 0,
    system:
      'You extract angle-profile codes from aluminium/steel window assembly drawings. ' +
      'Angle codes look like "ANG-1A", "ANG-1B", "ANG-2", "ANG-3", "ANG-2A1-2B", etc. ' +
      'They appear as small callout labels ANYWHERE inside the drawing — the top rail, ' +
      'the bottom rail/sill, the left and right jambs, and mullions — and are often ' +
      'placed on top of colored or gray filled blocks, which can make them low-contrast. ' +
      'You may be shown a full sheet or a zoomed-in crop of one; read every label you can. ' +
      'Scan systematically (top, then left, right, then bottom/sill) and do not stop after ' +
      'the first few; a single window frequently has several different ANG codes including ' +
      'one on the bottom sill. ' +
      'Return ONLY a compact JSON array of the unique codes you can actually see, ' +
      'uppercase, e.g. ["ANG-1A","ANG-1B","ANG-3"]. If you see none, return []. No prose.',
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
              'List every ANG-… angle code visible in this image as a JSON array. ' +
              'Check the bottom rail/sill and the mullions too, not only the corners.',
          },
        ],
      },
    ],
  });

  const text = res.content
    .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
    .join('\n')
    .trim();
  return parseAngleCodes(text);
}

/** Union the ANG codes detected across every image belonging to one page. */
async function detectAnglesOnPage(
  images: string[],
  anthropic: Anthropic,
  model: string,
): Promise<string[]> {
  const codes = new Set<string>();
  for (const img of images) {
    try {
      for (const c of await detectAnglesOnImage(img, anthropic, model)) {
        codes.add(c);
      }
    } catch {
      // ignore a single failed crop; other crops still contribute
    }
  }
  return [...codes];
}

/** Parse a Claude reply into a clean, validated list of ANG codes. */
export function parseAngleCodes(text: string): string[] {
  if (!text) return [];
  let raw: unknown;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  try {
    raw = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    // fall back to a regex scan of the reply text
    raw = text.match(/ANG-[A-Z0-9-]+/gi) ?? [];
  }
  const list = Array.isArray(raw) ? raw : [];
  const out = new Set<string>();
  for (const item of list) {
    const code = String(item).toUpperCase().trim().replace(/\s+/g, '');
    if (ANG_VALID_RE.test(code)) out.add(code);
  }
  return [...out];
}

export interface WindowPageRange {
  /** 0-based page indices covered by this window. */
  pages: number[];
}

/**
 * For each window, detect the ANG codes on the pages it covers.
 * Vision runs once per distinct page (each page as full view + high-res crops,
 * unioned), then codes are mapped back to windows.
 * Returns a list aligned by index with `windows`.
 */
export async function detectAngleCodesForWindows(
  buffer: Buffer,
  windows: WindowPageRange[],
  anthropic: Anthropic,
  model: string,
): Promise<string[][]> {
  // which pages do we actually need to look at?
  const neededPages = new Set<number>();
  for (const w of windows) {
    for (const p of w.pages) neededPages.add(p);
  }

  const imageSets = await renderPdfPageImageSets(buffer, neededPages);

  const perPage = new Map<number, string[]>();
  for (const [pageIndex, images] of imageSets) {
    perPage.set(
      pageIndex,
      await detectAnglesOnPage(images, anthropic, model),
    );
  }

  return windows.map((w) => {
    const codes = new Set<string>();
    for (const p of w.pages) {
      for (const c of perPage.get(p) ?? []) codes.add(c);
    }
    return [...codes];
  });
}
