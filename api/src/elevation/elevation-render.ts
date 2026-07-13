import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type ElevationCellKindValue = 'SPANDREL' | 'UNIT';

export interface RenderedCell {
  /** Primary code (mullion preferred), e.g. A7-F5-M56 */
  code: string;
  /** Floor token extracted from code, e.g. F5 */
  floor: string | null;
  kind: ElevationCellKindValue;
  /** All item codes inside the cell. */
  items: string[];
  /** Relative bbox within the page (0..1). */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface SectionMeta {
  label: string;
  /** Horizontal boundary range (0..1) — used for tab filtering + framing width. */
  x0: number;
  x1: number;
  /** Vertical extent of the section's cells (0..1) — used for framing height. */
  y0: number;
  y1: number;
}

export interface RenderedPage {
  pageIndex: number;
  width: number;
  height: number;
  pngBuffer: Buffer;
  cells: RenderedCell[];
  sections: SectionMeta[];
}

export interface RenderedElevation {
  pageCount: number;
  pages: RenderedPage[];
}

type Matrix = [number, number, number, number, number, number];

const RENDER_SCALE = 2;
/** Gray fill (#bababa) = Spandrel. */
const GRAY = [186, 186, 186];
/** Light-blue fill (#b5d7ed) = Unit. */
const CYAN = [181, 215, 237];
const COLOR_TOL = 32;
const MIN_CELL_PX = 6;

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseColor(v: unknown): [number, number, number] | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (t[0] === '#' && t.length === 7) {
    return [
      parseInt(t.slice(1, 3), 16),
      parseInt(t.slice(3, 5), 16),
      parseInt(t.slice(5, 7), 16),
    ];
  }
  return null;
}
function near(c: number[] | null, t: number[], tol = COLOR_TOL): boolean {
  return (
    !!c &&
    Math.abs(c[0] - t[0]) < tol &&
    Math.abs(c[1] - t[1]) < tol &&
    Math.abs(c[2] - t[2]) < tol
  );
}
const isGray = (c: number[] | null) => near(c, GRAY);
const isCyan = (c: number[] | null) => near(c, CYAN);

/** PDF text may render Hebrew reversed; flip pure-Hebrew tokens back. */
function fixRtl(s: string): string {
  const hasHebrew = /[\u0590-\u05FF]/.test(s);
  const hasLatin = /[A-Za-z0-9]/.test(s);
  if (hasHebrew && !hasLatin) {
    return s.split('').reverse().join('');
  }
  return s;
}

/** A7-F5-M56 -> F5 ; SL-L2-1 -> L2 ; otherwise null */
function extractFloor(code: string): string | null {
  const m = code.match(/-(F\d+|L\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Prefer a mullion code (…-M\d+) as the cell's primary code. */
function pickPrimaryCode(items: string[]): string {
  const mull = items.find((i) => /-M\d+/i.test(i));
  if (mull) return mull;
  const coded = items.find((i) => /[A-Z]\d|-\w/.test(i));
  return coded ?? items[0] ?? '';
}

interface Band {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  kind: ElevationCellKindValue;
}
interface VLine {
  x: number;
  y0: number;
  y1: number;
}
interface Frag {
  str: string;
  cx: number;
  y: number;
  h: number;
}
interface RawCell {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  kind: ElevationCellKindValue;
}

const OPS = pdfjs.OPS as unknown as Record<string, number>;

function paintSets() {
  const fill = new Set<number>([
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const stroke = new Set<number>([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  return { fill, stroke };
}

async function renderOnePage(
  page: Awaited<ReturnType<pdfjs.PDFDocumentProxy['getPage']>>,
  pageIndex: number,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const W = Math.ceil(viewport.width);
  const H = Math.ceil(viewport.height);
  const viewportMatrix = Array.from(viewport.transform) as Matrix;

  const opList = await page.getOperatorList();
  const { fill: FILL, stroke: STROKE } = paintSets();

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let fillColor: [number, number, number] | null = null;

  const bands: Band[] = [];
  const vlines: VLine[] = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown;
    if (fn === OPS.save) stack.push(ctm.slice() as Matrix);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as Matrix);
    else if (fn === OPS.setFillRGBColor) fillColor = parseColor(args);
    else if (fn === OPS.setFillGray && Array.isArray(args)) {
      const g = Math.round((args[0] as number) * 255);
      fillColor = [g, g, g];
    } else if (fn === OPS.constructPath && Array.isArray(args)) {
      const paint = args[0] as number;
      const mm = args[2] as Record<number, number>;
      if (!mm) continue;
      const dev = mul(viewportMatrix, ctm);
      const a = applyPoint(dev, mm[0], mm[1]);
      const b = applyPoint(dev, mm[2], mm[3]);
      const minx = Math.min(a[0], b[0]);
      const maxx = Math.max(a[0], b[0]);
      const miny = Math.min(a[1], b[1]);
      const maxy = Math.max(a[1], b[1]);
      const w = maxx - minx;
      const h = maxy - miny;
      if (FILL.has(paint)) {
        const kind: ElevationCellKindValue | null = isGray(fillColor)
          ? 'SPANDREL'
          : isCyan(fillColor)
            ? 'UNIT'
            : null;
        if (kind && w > 4 && h > 4) bands.push({ minx, miny, maxx, maxy, kind });
      }
      if (STROKE.has(paint) && w < 3 && h > 8) {
        vlines.push({ x: (minx + maxx) / 2, y0: miny, y1: maxy });
      }
    }
  }

  // text fragments
  const textContent = await page.getTextContent();
  const frags: Frag[] = [];
  for (const item of textContent.items) {
    const str = (item as { str?: string }).str;
    if (typeof str !== 'string' || !str.trim()) continue;
    const transform = (item as { transform: number[] }).transform;
    const width = (item as { width?: number }).width ?? 0;
    const height = (item as { height?: number }).height ?? 0;
    const mapped = pdfjs.Util.transform(
      viewportMatrix,
      transform,
    ) as number[];
    frags.push({
      str: str.trim(),
      cx: mapped[4] + width / 2,
      y: mapped[5],
      h: height * RENDER_SCALE,
    });
  }

  // subdivide each band by vertical grid lines crossing it
  const rawCells: RawCell[] = [];
  for (const band of bands) {
    const crossing = vlines.filter(
      (v) =>
        v.x >= band.minx - 2 &&
        v.x <= band.maxx + 2 &&
        v.y0 < band.maxy &&
        v.y1 > band.miny,
    );
    const xs = [band.minx, ...crossing.map((v) => v.x), band.maxx].sort(
      (p, q) => p - q,
    );
    const merged: number[] = [];
    for (const x of xs) {
      if (!merged.length || x - merged[merged.length - 1] > 3) merged.push(x);
    }
    for (let i = 0; i < merged.length - 1; i += 1) {
      const x0 = merged[i];
      const x1 = merged[i + 1];
      if (x1 - x0 < MIN_CELL_PX) continue;
      rawCells.push({
        minx: x0,
        miny: band.miny,
        maxx: x1,
        maxy: band.maxy,
        kind: band.kind,
      });
    }
  }

  const deduped = dedupeCells(rawCells);

  const bandCells: RenderedCell[] = [];
  for (const c of deduped) {
    const inside = frags
      .filter((f) => f.cx >= c.minx && f.cx <= c.maxx && f.y >= c.miny && f.y <= c.maxy)
      .map((f) => fixRtl(f.str));
    const items = uniquePreserveOrder(inside);
    if (!items.length) continue;
    const code = pickPrimaryCode(items);
    bandCells.push({
      code,
      floor: code ? extractFloor(code) : null,
      kind: c.kind,
      items,
      bbox: {
        x: c.minx / W,
        y: c.miny / H,
        w: (c.maxx - c.minx) / W,
        h: (c.maxy - c.miny) / H,
      },
    });
  }

  // Preferred: one clickable rectangle per window-type code label (grid layout),
  // which merges each window's spandrel + glazing into a single unit. Falls back
  // to the color-band cells when the sheet has no code-label grid.
  const anchorCells = buildAnchorCells(frags, W, H);
  const cells = anchorCells.length >= 3 ? anchorCells : bandCells;

  const sections = computeSections(frags, cells, W);

  // render background image
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const pngBuffer = canvas.toBuffer('image/png');

  return { pageIndex, width: W, height: H, pngBuffer, cells, sections };
}

/** Exact window/unit type code, e.g. 74-1-12A or 74-1-10. */
const CODE_EXACT = /^\d{2}-\d-\d{2}[A-Z]?$/;

interface Anchor {
  code: string;
  cx: number;
  cy: number;
}

/** Cluster 1-D values (sorted) into center points, splitting on gaps > `gap`. */
function clusterCenters(values: number[], gap: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v - last[last.length - 1] <= gap) last.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((s, x) => s + x, 0) / g.length);
}

/**
 * Build one clickable rectangle per window-type code label, using the text
 * layer as anchors. Each label (e.g. 74-1-12A) sits at the top of its cell; the
 * rectangle spans its column width and reaches down to the next label below in
 * the same column — merging spandrel + glazing into a single unit. Returns []
 * when the sheet has no code-label grid (caller falls back to band cells).
 */
function buildAnchorCells(frags: Frag[], W: number, H: number): RenderedCell[] {
  const raw: Anchor[] = [];
  for (const f of frags) {
    const s = fixRtl(f.str);
    if (CODE_EXACT.test(s)) raw.push({ code: s, cx: f.cx / W, cy: f.y / H });
  }
  if (raw.length < 3) return [];

  // dedupe base vs lettered code at the same spot (74-1-12 + 74-1-12A) → keep lettered/longest
  raw.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const anchors: Anchor[] = [];
  for (const a of raw) {
    const dup = anchors.find(
      (b) => Math.abs(b.cx - a.cx) < 0.012 && Math.abs(b.cy - a.cy) < 0.012,
    );
    if (!dup) {
      anchors.push({ ...a });
      continue;
    }
    const aLetter = /[A-Z]$/.test(a.code);
    const bLetter = /[A-Z]$/.test(dup.code);
    if ((aLetter && !bLetter) || (aLetter === bLetter && a.code.length > dup.code.length)) {
      dup.code = a.code;
    }
  }

  const colCenters = clusterCenters(
    anchors.map((a) => a.cx),
    0.015,
  );
  if (!colCenters.length) return [];
  const colOf = (cx: number) =>
    colCenters.reduce(
      (best, c, i) =>
        Math.abs(c - cx) < Math.abs(colCenters[best] - cx) ? i : best,
      0,
    );
  const colBounds = colCenters.map((c, i) => {
    const prev = colCenters[i - 1];
    const next = colCenters[i + 1];
    const half =
      next !== undefined
        ? (next - c) / 2
        : prev !== undefined
          ? (c - prev) / 2
          : 0.017;
    const left = prev !== undefined ? (prev + c) / 2 : c - half;
    const right = next !== undefined ? (c + next) / 2 : c + half;
    return { left, right };
  });

  const byCol = new Map<number, Anchor[]>();
  for (const a of anchors) {
    const ci = colOf(a.cx);
    if (!byCol.has(ci)) byCol.set(ci, []);
    byCol.get(ci)!.push(a);
  }

  // median vertical spacing between stacked labels (row height)
  const diffs: number[] = [];
  for (const list of byCol.values()) {
    list.sort((p, q) => p.cy - q.cy);
    for (let i = 1; i < list.length; i += 1) diffs.push(list[i].cy - list[i - 1].cy);
  }
  diffs.sort((a, b) => a - b);
  const medianRow = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0.06;

  const TOP_PAD = 0.008;
  const GAP = 0.004;
  const cells: RenderedCell[] = [];
  for (const [ci, list] of byCol.entries()) {
    const b = colBounds[ci];
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      const y0 = Math.max(0, a.cy - TOP_PAD);
      const y1 = Math.min(
        1,
        i + 1 < list.length ? list[i + 1].cy - GAP : a.cy + medianRow,
      );
      if (y1 - y0 < 0.008) continue;
      const x0 = Math.max(0, b.left);
      const x1 = Math.min(1, b.right);
      const items = uniquePreserveOrder(
        frags
          .filter((f) => {
            const fx = f.cx / W;
            const fy = f.y / H;
            return fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1;
          })
          .map((f) => fixRtl(f.str)),
      );
      cells.push({
        code: a.code,
        floor: extractFloor(a.code),
        kind: 'UNIT',
        items: items.length ? items : [a.code],
        bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      });
    }
  }
  return cells;
}

/**
 * Detect the big "… PART" section headers (e.g. CENTRAL PART / LEFT PART /
 * LEFT PART CORNER) and split the page into contiguous horizontal regions.
 * Headers are the largest text fragments matching the section keywords; the
 * boundary between two adjacent sections is the midpoint of their centers.
 */
function computeSections(
  frags: Frag[],
  cells: RenderedCell[],
  W: number,
): SectionMeta[] {
  const candidates = frags.filter((f) =>
    /\bPART\b|CORNER|CENTRAL/i.test(f.str),
  );
  if (!candidates.length) return [];
  const maxH = Math.max(...candidates.map((f) => f.h));
  // keep only the prominent (header-sized) labels, dedupe by label text
  const seen = new Set<string>();
  const headers = candidates
    .filter((f) => f.h >= Math.max(maxH * 0.7, 20))
    .filter((f) => {
      const key = f.str.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f) => ({ label: f.str, center: f.cx / W }))
    .sort((a, b) => a.center - b.center);

  if (headers.length < 2) return [];

  const sections: SectionMeta[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const x0 =
      i === 0 ? 0 : (headers[i - 1].center + headers[i].center) / 2;
    const x1 =
      i === headers.length - 1
        ? 1
        : (headers[i].center + headers[i + 1].center) / 2;
    const inside = cells.filter((c) => {
      const cx = c.bbox.x + c.bbox.w / 2;
      return cx >= x0 && cx < x1;
    });
    let y0 = 0;
    let y1 = 1;
    if (inside.length) {
      y0 = Math.min(...inside.map((c) => c.bbox.y));
      y1 = Math.max(...inside.map((c) => c.bbox.y + c.bbox.h));
    }
    sections.push({ label: headers[i].label, x0, x1, y0, y1 });
  }
  return sections;
}

function area(c: RawCell): number {
  return (c.maxx - c.minx) * (c.maxy - c.miny);
}
function intersectArea(a: RawCell, b: RawCell): number {
  const x = Math.max(0, Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx));
  const y = Math.max(0, Math.min(a.maxy, b.maxy) - Math.max(a.miny, b.miny));
  return x * y;
}

/** Remove exact duplicates and slivers contained inside larger cells. */
function dedupeCells(cells: RawCell[]): RawCell[] {
  // exact-ish dedup by rounded key
  const byKey = new Map<string, RawCell>();
  for (const c of cells) {
    const key = `${Math.round(c.minx / 3)},${Math.round(c.miny / 3)},${Math.round(
      c.maxx / 3,
    )},${Math.round(c.maxy / 3)}`;
    if (!byKey.has(key)) byKey.set(key, c);
  }
  const unique = [...byKey.values()].sort((a, b) => area(b) - area(a));
  // drop cells whose area is >=85% covered by a larger, already-kept cell
  const kept: RawCell[] = [];
  for (const c of unique) {
    const covered = kept.some((k) => intersectArea(k, c) / area(c) >= 0.85);
    if (!covered) kept.push(c);
  }
  return kept;
}

function uniquePreserveOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Cheap content probe (no canvas render): does this PDF look like a facade
 * elevation map? Detected by the presence of the gray (spandrel) + cyan (unit)
 * filled cells — independent of file name or the chosen document kind.
 */
export async function detectElevationSignature(
  fileBuffer: Buffer,
): Promise<{ isElevation: boolean; grayFills: number; cyanFills: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer) })
    .promise;
  try {
    const { fill: FILL } = paintSets();
    let grayFills = 0;
    let cyanFills = 0;
    const maxPages = Math.min(doc.numPages, 3);
    for (let p = 1; p <= maxPages; p += 1) {
      const page = await doc.getPage(p);
      const opList = await page.getOperatorList();
      let fillColor: [number, number, number] | null = null;
      for (let i = 0; i < opList.fnArray.length; i += 1) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i] as unknown;
        if (fn === OPS.setFillRGBColor) fillColor = parseColor(args);
        else if (fn === OPS.setFillGray && Array.isArray(args)) {
          const g = Math.round((args[0] as number) * 255);
          fillColor = [g, g, g];
        } else if (fn === OPS.constructPath && Array.isArray(args)) {
          if (FILL.has(args[0] as number)) {
            if (isGray(fillColor)) grayFills += 1;
            else if (isCyan(fillColor)) cyanFills += 1;
          }
        }
      }
      if (grayFills >= 3 && cyanFills >= 3) break;
    }
    return { isElevation: grayFills >= 3 && cyanFills >= 3, grayFills, cyanFills };
  } finally {
    await doc.destroy();
  }
}

export async function renderElevation(
  fileBuffer: Buffer,
): Promise<RenderedElevation> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer) })
    .promise;
  try {
    const pages: RenderedPage[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      pages.push(await renderOnePage(page, p - 1));
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}
