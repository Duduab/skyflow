import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface RowDrawingCrop {
  /** PNG bytes of the cropped "שרטוט" (drawing) cell for this data row. */
  pngBuffer: Buffer;
  /** Ratio of non-white pixels in the crop (0..1). Used to drop blank cells. */
  nonWhiteRatio: number;
}

export interface ParsedHeader {
  partNumber: string;
  systemType: string;
  orderNumber: string;
  date: string;
}

export interface ParsedItem {
  description: string;
  drawingImageUrl: string;
  sku: string;
  units: string;
  meters: string;
  shade: string;
  supplier: string;
  unitPrice: string;
  totalCost: string;
  invoice: string;
}

export interface ParsedPlan {
  /** Base64 PNG of the full first page (used as a Claude fallback only). */
  pageImageBase64: string;
  /** Deterministically parsed header, or null when the grid/text was unusable. */
  header: ParsedHeader | null;
  /** Deterministically parsed rows (empty when parsing was not possible). */
  items: ParsedItem[];
  /** Per-row flag: true when the drawing cell holds a figure (not text/empty). */
  hasDrawing: boolean[];
  /** Per-row crop of the drawing cell, aligned by index with `items`. */
  rowCrops: RowDrawingCrop[];
}

const RENDER_SCALE = 3;
const MIN_LINE_LENGTH = 15;
const STRAIGHT_TOL = 2;
const GRID_MERGE_TOL = 4;
const MIN_DRAWING_NONWHITE_RATIO = 0.015;

type Matrix = [number, number, number, number, number, number];

interface Fragment {
  str: string;
  cx: number; // center x in scale-1 device space
  y: number; // baseline y in scale-1 device space
  height: number;
}

interface ColumnMap {
  description: number;
  drawing: number;
  sku: number;
  units: number;
  meters: number;
  shade: number;
  supplier: number;
  unitPrice: number;
  totalCost: number;
  invoice: number;
}

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

function uniqueSorted(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(v - out[out.length - 1]) > tolerance) {
      out.push(v);
    }
  }
  return out;
}

function normalizeHeader(value: string): string {
  return value.replace(/[\s"'`.,:;|״׳()]/g, '');
}

export async function renderPlanPdf(fileBuffer: Buffer): Promise<ParsedPlan> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer) }).promise;
  try {
    const page = await doc.getPage(1);

    // Scale-1 space is used for grid + text geometry.
    const baseViewport = page.getViewport({ scale: 1 });
    const baseMatrix = Array.from(baseViewport.transform) as Matrix;

    // High-res render is used for drawing crops and the Claude fallback image.
    const renderViewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(
      Math.ceil(renderViewport.width),
      Math.ceil(renderViewport.height),
    );
    const ctx = canvas.getContext('2d');
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: renderViewport,
    }).promise;
    const pageImageBase64 = canvas.toBuffer('image/png').toString('base64');

    const opList = await page.getOperatorList();
    const { columns, rows } = extractGrid(opList, baseMatrix);

    const fragments = await readFragments(page, baseMatrix);

    const empty: ParsedPlan = {
      pageImageBase64,
      header: null,
      items: [],
      hasDrawing: [],
      rowCrops: [],
    };

    if (columns.length < 3 || rows.length < 2 || !fragments.length) {
      return empty;
    }

    const headerBandIndex = findHeaderBandIndex(fragments, rows);
    if (headerBandIndex < 0) return empty;

    const colMap = mapColumns(fragments, columns, rows, headerBandIndex);
    if (!colMap) return empty;

    const dataBands: Array<[number, number]> = [];
    for (let i = headerBandIndex + 1; i < rows.length - 1; i += 1) {
      dataBands.push([rows[i], rows[i + 1]]);
    }
    if (!dataBands.length) return empty;

    const header = parseHeaderBlock(fragments, rows[headerBandIndex]);
    const { items, hasDrawing } = parseDataRows(fragments, columns, dataBands, colMap);
    const rowCrops = cropDrawingCells(ctx, canvas.width, canvas.height, columns, colMap, dataBands);

    return { pageImageBase64, header, items, hasDrawing, rowCrops };
  } finally {
    await doc.destroy();
  }
}

function extractGrid(
  opList: { fnArray: ArrayLike<number>; argsArray: unknown[] },
  viewportMatrix: Matrix,
): { columns: number[]; rows: number[] } {
  const OPS = pdfjs.OPS as Record<string, number>;
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const horizontalY: number[] = [];
  const verticalX: number[] = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS['save']) {
      stack.push(ctm.slice() as Matrix);
    } else if (fn === OPS['restore']) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS['transform']) {
      ctm = mul(ctm, args as Matrix);
    } else if (fn === OPS['constructPath']) {
      const subpaths = (args as unknown[])[1] as Array<ArrayLike<number>>;
      const device = mul(viewportMatrix, ctm);
      for (const pts of subpaths) {
        let cx = 0;
        let cy = 0;
        for (let k = 0; k + 2 < pts.length; k += 3) {
          const code = pts[k];
          const [dx, dy] = applyPoint(device, pts[k + 1], pts[k + 2]);
          if (code === 0) {
            cx = dx;
            cy = dy;
          } else {
            if (Math.abs(dy - cy) < STRAIGHT_TOL && Math.abs(dx - cx) > MIN_LINE_LENGTH) {
              horizontalY.push((dy + cy) / 2);
            } else if (Math.abs(dx - cx) < STRAIGHT_TOL && Math.abs(dy - cy) > MIN_LINE_LENGTH) {
              verticalX.push((dx + cx) / 2);
            }
            cx = dx;
            cy = dy;
          }
        }
      }
    }
  }

  return {
    columns: uniqueSorted(verticalX, GRID_MERGE_TOL),
    rows: uniqueSorted(horizontalY, GRID_MERGE_TOL),
  };
}

async function readFragments(
  page: Awaited<ReturnType<pdfjs.PDFDocumentProxy['getPage']>>,
  viewportMatrix: Matrix,
): Promise<Fragment[]> {
  const textContent = await page.getTextContent();
  const fragments: Fragment[] = [];
  for (const item of textContent.items) {
    const str = (item as { str?: string }).str;
    if (typeof str !== 'string' || !str.trim()) continue;
    const transform = (item as { transform: number[] }).transform;
    const width = (item as { width?: number }).width ?? 0;
    const height = (item as { height?: number }).height ?? 10;
    const mapped = pdfjs.Util.transform(viewportMatrix, transform) as number[];
    fragments.push({
      str,
      cx: mapped[4] + width / 2,
      y: mapped[5],
      height: Math.max(6, height),
    });
  }
  return fragments;
}

function columnIndexOf(cx: number, columns: number[]): number {
  for (let i = 0; i < columns.length - 1; i += 1) {
    if (cx >= columns[i] && cx <= columns[i + 1]) return i;
  }
  return -1;
}

function findHeaderBandIndex(fragments: Fragment[], rows: number[]): number {
  const drawing = fragments.find((f) => normalizeHeader(f.str).includes('שרטוט'));
  const anchorY = drawing
    ? drawing.y
    : fragments.find((f) => normalizeHeader(f.str).includes('הפריט'))?.y;
  if (anchorY === undefined) return -1;
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (anchorY >= rows[i] && anchorY <= rows[i + 1]) return i;
  }
  return -1;
}

function mapColumns(
  fragments: Fragment[],
  columns: number[],
  rows: number[],
  headerBandIndex: number,
): ColumnMap | null {
  const top = rows[headerBandIndex];
  const bottom = rows[headerBandIndex + 1];
  const perColumn: string[] = new Array(columns.length - 1).fill('');
  for (const f of fragments) {
    if (f.y < top || f.y > bottom) continue;
    const idx = columnIndexOf(f.cx, columns);
    if (idx < 0) continue;
    perColumn[idx] += normalizeHeader(f.str);
  }

  const findCol = (keywords: string[]): number => {
    for (let i = 0; i < perColumn.length; i += 1) {
      if (keywords.some((k) => perColumn[i].includes(k))) return i;
    }
    return -1;
  };

  const map: ColumnMap = {
    description: findCol(['הפריט', 'תיאור', 'תאור']),
    drawing: findCol(['שרטוט']),
    sku: findCol(['מקט', 'מק']),
    units: findCol(['יחידות']),
    meters: findCol(['מא', 'אמ']),
    shade: findCol(['גוון']),
    supplier: findCol(['ספק']),
    unitPrice: findCol(['מחיריחידה', 'מחיר']),
    totalCost: findCol(['עלות', 'סהכ']),
    invoice: findCol(['חשבונית']),
  };

  if (map.description < 0 || map.units < 0 || map.meters < 0) return null;
  return map;
}

function cellText(
  fragments: Fragment[],
  columns: number[],
  columnIndex: number,
  top: number,
  bottom: number,
): string {
  if (columnIndex < 0) return '';
  const inCell = fragments.filter(
    (f) => f.y > top && f.y <= bottom && columnIndexOf(f.cx, columns) === columnIndex,
  );
  if (!inCell.length) return '';

  // Group into visual lines by y, then read each line right-to-left (RTL).
  inCell.sort((a, b) => a.y - b.y);
  const lines: Fragment[][] = [];
  for (const f of inCell) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(f.y - last[0].y) <= last[0].height * 0.8) {
      last.push(f);
    } else {
      lines.push([f]);
    }
  }

  const lineStrings = lines.map((line) =>
    line
      .sort((a, b) => b.cx - a.cx)
      .map((f) => f.str.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return lineStrings.join(' ').replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim();
}

function parseDataRows(
  fragments: Fragment[],
  columns: number[],
  dataBands: Array<[number, number]>,
  map: ColumnMap,
): { items: ParsedItem[]; hasDrawing: boolean[] } {
  const items: ParsedItem[] = [];
  const hasDrawing: boolean[] = [];
  for (const [top, bottom] of dataBands) {
    const get = (col: number) => cellText(fragments, columns, col, top, bottom);
    const description = get(map.description);
    const drawingCellText = get(map.drawing);
    const item: ParsedItem = {
      description,
      drawingImageUrl: '',
      sku: get(map.sku),
      units: get(map.units),
      meters: get(map.meters),
      shade: get(map.shade),
      supplier: get(map.supplier),
      unitPrice: get(map.unitPrice),
      totalCost: get(map.totalCost),
      invoice: get(map.invoice),
    };
    // Drop fully empty trailing rows.
    const hasAny = Object.values(item).some((v) => typeof v === 'string' && v.length > 0);
    if (!hasAny && !drawingCellText) continue;
    items.push(item);
    // A drawing cell that contains text (e.g. "יתוכנן בהמשך") is a note, not a figure.
    hasDrawing.push(drawingCellText.length === 0);
  }
  return { items, hasDrawing };
}

function parseHeaderBlock(fragments: Fragment[], tableTopY: number): ParsedHeader {
  const preTable = fragments.filter((f) => f.y < tableTopY);

  const valueLeftOf = (keyword: string): string => {
    const label = preTable.find((f) => normalizeHeader(f.str).includes(keyword));
    if (!label) return '';
    const candidates = preTable
      .filter((f) => Math.abs(f.y - label.y) < 8 && f.cx < label.cx)
      .sort((a, b) => b.cx - a.cx);
    for (const c of candidates) {
      if (/[0-9A-Za-z]/.test(c.str)) {
        return c.str.replace(/[:'"]/g, '').trim();
      }
    }
    return '';
  };

  return {
    partNumber: valueLeftOf('פריט'),
    systemType: valueLeftOf('מערכת'),
    orderNumber: valueLeftOf('הזמנה'),
    date: valueLeftOf('תאריך'),
  };
}

function cropDrawingCells(
  ctx: SKRSContext2D,
  canvasWidth: number,
  canvasHeight: number,
  columns: number[],
  map: ColumnMap,
  dataBands: Array<[number, number]>,
): RowDrawingCrop[] {
  const crops: RowDrawingCrop[] = [];
  if (map.drawing < 0) {
    return dataBands.map(() => ({ pngBuffer: Buffer.alloc(0), nonWhiteRatio: 0 }));
  }
  const left = columns[map.drawing] * RENDER_SCALE;
  const right = columns[map.drawing + 1] * RENDER_SCALE;
  const inset = 3 * RENDER_SCALE;

  for (const [topBase, bottomBase] of dataBands) {
    const top = topBase * RENDER_SCALE;
    const bottom = bottomBase * RENDER_SCALE;
    const x = Math.max(0, Math.round(left + inset));
    const y = Math.max(0, Math.round(top + inset));
    const w = Math.min(canvasWidth - x, Math.round(right - left - inset * 2));
    const h = Math.min(canvasHeight - y, Math.round(bottom - top - inset * 2));
    if (w <= 0 || h <= 0) {
      crops.push({ pngBuffer: Buffer.alloc(0), nonWhiteRatio: 0 });
      continue;
    }
    const sub = createCanvas(w, h);
    const subCtx = sub.getContext('2d');
    subCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
    const { data } = subCtx.getImageData(0, 0, w, h);
    let nonWhite = 0;
    for (let p = 0; p < data.length; p += 4) {
      if (data[p] < 240 || data[p + 1] < 240 || data[p + 2] < 240) nonWhite += 1;
    }
    crops.push({
      pngBuffer: sub.toBuffer('image/png'),
      nonWhiteRatio: nonWhite / (w * h),
    });
  }
  return crops;
}

export { MIN_DRAWING_NONWHITE_RATIO };
