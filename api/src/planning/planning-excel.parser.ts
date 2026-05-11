import * as XLSX from 'xlsx';
import {
  ProductComponentKind,
  ProductType,
} from '@prisma/client';

export interface ParsedProductComponent {
  kind: ProductComponentKind;
  description: string;
  quantity: number;
  spec: string | null;
}

export interface ParsedProductItem {
  productType: ProductType;
  instructionKind: string;
  label: string;
  components: ParsedProductComponent[];
}

export interface PlanningParseResult {
  sheetName: string;
  items: ParsedProductItem[];
}

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim();
}

/** Normalize header for matching (newlines, NBSP, collapse spaces). */
function normalizeHeaderText(h: string): string {
  return norm(h)
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function shortHeaderLabel(h: string): string {
  const first = norm(h).split(/\r?\n/)[0] ?? '';
  return first.replace(/\s+/g, ' ').trim().slice(0, 56);
}

/** קוד יחידה בגליון (GL-2, H-4, W-GL-1, LOU-2 …) */
const UNIT_REF = /^(GL|H|W|LOU|LO)[-A-Z0-9]+$/i;

function findUnitRefsInRow(row: string[]): string[] {
  const refs: string[] = [];
  for (const c of row) {
    const v = norm(c);
    if (UNIT_REF.test(v) && v.length <= 32) refs.push(v);
  }
  return refs;
}

/** כמות יחידות בשורת התכנון — מוטמעת ב־label כ־(×26) אחרי הפרסור הראשוני */
function lineQtyFromLabel(label: string): number {
  const m = label.match(/\((?:×|x)(\d+)\)/i);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * תפ״י — פרופילים (MPS/MPB/YAGUAR …) = קורה; משקוף/כנף/הגבהה; SUBFRAME/GYPSUM/גימורים = משקוף.
 */
function classifyComponentHeader(combinedHeader: string): ProductComponentKind | null {
  const h = normalizeHeaderText(combinedHeader);
  if (!h) return null;

  if (h.includes('כיוון פתיחה') || h.includes('opening')) return null;
  if (h.includes('name of unit') || h.includes('name of window')) return null;
  if (h.includes('quantity') || h.includes('كمية')) return null;
  if (h.includes('consists of')) return null;
  if (h.includes('width (mm)') || h.includes('height (mm)')) return null;

  if (h.includes('משקוף') || h.includes('mishkof')) return ProductComponentKind.FRAME;
  if (h.includes('כנף') || h.includes('sash')) return ProductComponentKind.SASH;
  if (h.includes('הגבהה')) return ProductComponentKind.FRAME;
  if (h.includes('double') && h.includes('yaguar')) {
    return ProductComponentKind.GLASS_DOUBLE;
  }
  if (h.includes('זכוכית') || h.includes('glass')) {
    return h.includes('double') || h.includes('כפול')
      ? ProductComponentKind.GLASS_DOUBLE
      : ProductComponentKind.GLASS_SINGLE;
  }
  if (
    h.includes('subframe') ||
    h.includes('gypsum') ||
    h.includes('גבס') ||
    h.includes('maavir') ||
    h.includes('finish angle') ||
    h.includes('sheet metal')
  ) {
    return ProductComponentKind.FRAME;
  }
  if (
    h.includes('mps-') ||
    h.includes('mpb-') ||
    h.includes('yaguar') ||
    h.includes('shprotz') ||
    h.includes('louver')
  ) {
    return ProductComponentKind.BEAM;
  }
  return ProductComponentKind.BEAM;
}

function sheetInstructionKind(sheetName: string): string {
  const s = norm(sheetName).replace(/\s+/g, ' ');
  const l = s.toLowerCase();
  if (l.includes('window instruction')) return 'WINDOW_INSTRUCTION';
  const m = s.match(/type\s*[- ]?\s*(\d+)/i);
  if (m) return `TYPE_${m[1]}`;
  return s.replace(/\s+/g, '_').toUpperCase().slice(0, 32);
}

function sheetProductType(sheetName: string): ProductType {
  const l = norm(sheetName).toLowerCase();
  return l.includes('window instruction') ? ProductType.WINDOW : ProductType.UNIT;
}

function findMainHeaderRow(matrix: string[][]): number {
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const cells = (matrix[r] ?? []).map((c) => normalizeHeaderText(norm(c)));
    const hasQty = cells.some((c) => c.includes('quantity'));
    const hasName =
      cells.some((c) => c.includes('name of unit')) ||
      cells.some((c) => c.includes('name of window'));
    const hasWidth = cells.some((c) => c.includes('width (mm)'));
    if (hasQty && hasName && hasWidth) return r;
  }
  return 7;
}

function findCol(
  headerRow: string[],
  predicate: (h: string) => boolean,
): number {
  for (let c = 0; c < headerRow.length; c++) {
    if (predicate(normalizeHeaderText(norm(headerRow[c])))) return c;
  }
  return -1;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((c) => !norm(c));
}

function isSecondaryHeaderRow(
  row: string[],
  nameCol: number,
  qtyCol: number,
): boolean {
  const n = norm(row[nameCol]);
  const q = norm(row[qtyCol]);
  const hasQty = /^\d+$/.test(q) && parseInt(q, 10) > 0;
  if (hasQty && n.length > 0 && /^[A-Z0-9.\-]+$/i.test(n)) return false;
  let longText = 0;
  let digits = 0;
  for (const c of row) {
    const v = norm(c);
    if (!v) continue;
    if (/^\d+(\.\d+)?$/.test(v)) digits++;
    if (v.length >= 18) longText++;
  }
  return longText >= 2 && digits <= 2;
}

function mergeOverlayHeaders(base: string[], overlay: string[]): string[] {
  const len = Math.max(base.length, overlay.length);
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const b = norm(base[i] ?? '');
    const o = norm(overlay[i] ?? '');
    if (o && b) out.push(`${b} | ${o}`);
    else out.push(o || b);
  }
  return out;
}

function isPrimaryUnitRow(
  row: string[],
  nameCol: number,
  qtyCol: number,
): boolean {
  const n = norm(row[nameCol]);
  const q = norm(row[qtyCol]);
  if (!n || !/^\d+$/.test(q)) return false;
  if (!/^[A-Z0-9.\-]+$/i.test(n)) return false;
  return parseInt(q, 10) > 0;
}

function rowHasMeasurableValues(
  row: string[],
  nameCol: number,
  qtyCol: number,
  consistsCol: number,
): boolean {
  for (let c = 0; c < row.length; c++) {
    if (c === nameCol || c === qtyCol || c === consistsCol) continue;
    const v = norm(row[c]);
    if (!v || v === '-') continue;
    if (/^\d+(\.\d+)?$/.test(v)) return true;
  }
  return false;
}

function addGlassFromCorners(
  components: ParsedProductComponent[],
  row: string[],
): void {
  const w0 = norm(row[0]);
  const h0 = norm(row[1]);
  const w1 = norm(row[2]);
  const h1 = norm(row[3]);
  if (w0 && h0 && /^\d+(\.\d+)?$/.test(w0) && /^\d+(\.\d+)?$/.test(h0)) {
    components.push({
      kind: ProductComponentKind.GLASS_SINGLE,
      description: 'זכוכית / מידות (רוחב×גובה)',
      quantity: 1,
      spec: `${w0}×${h0} mm`,
    });
  }
  if (w1 && h1 && /^\d+(\.\d+)?$/.test(w1) && /^\d+(\.\d+)?$/.test(h1)) {
    components.push({
      kind: ProductComponentKind.GLASS_SINGLE,
      description: 'גריד / מידות (רוחב×גובה)',
      quantity: 1,
      spec: `${w1}×${h1} mm`,
    });
  }
}

function collectRowComponents(
  row: string[],
  headerRow: string[],
  nameCol: number,
  qtyCol: number,
  consistsCol: number,
  into: ParsedProductComponent[],
): void {
  addGlassFromCorners(into, row);

  for (let c = 0; c < row.length; c++) {
    if (c === nameCol || c === qtyCol || c === consistsCol) continue;
    if (c < 4) continue;
    const cell = norm(row[c]);
    if (!cell || cell === '-') continue;
    const hdr = headerRow[c] ?? '';
    const kind = classifyComponentHeader(hdr);
    if (!kind) continue;

    const label = shortHeaderLabel(hdr) || String(kind);
    const isNum = /^\d+(\.\d+)?$/.test(cell);
    if (isNum) {
      into.push({
        kind,
        description: `${label} (mm)`,
        quantity: 1,
        spec: cell,
      });
    } else {
      into.push({
        kind,
        description: label,
        quantity: 1,
        spec: cell,
      });
    }
  }
}

function parseBlockToItem(
  block: string[][],
  headerRow: string[],
  sheetName: string,
  productType: ProductType,
  instructionKind: string,
): ParsedProductItem | null {
  if (!block.length) return null;
  const nameCol = findCol(headerRow, (h) => h.includes('name of unit') || h.includes('name of window'));
  const qtyCol = findCol(headerRow, (h) => h.includes('quantity'));
  const consistsCol = findCol(headerRow, (h) => h.includes('consists of'));
  if (nameCol < 0 || qtyCol < 0) return null;

  const head = block[0] ?? [];
  const unitName = norm(head[nameCol]);
  const qtyRaw = norm(head[qtyCol]);
  const qty = /^\d+$/.test(qtyRaw) ? Math.max(1, parseInt(qtyRaw, 10)) : 1;
  const consists = consistsCol >= 0 ? norm(head[consistsCol]) : '';

  const components: ParsedProductComponent[] = [];
  for (const row of block) {
    collectRowComponents(row, headerRow, nameCol, qtyCol, consistsCol, components);
  }

  for (const c of components) {
    const per = Math.max(1, Math.floor(Number(c.quantity) || 1));
    c.quantity = per * qty;
  }

  const labelParts = [`[${sheetName}]`, unitName, `(×${qty})`];
  if (consists) labelParts.push(`— ${consists}`);

  return {
    productType,
    instructionKind,
    label: labelParts.join(' '),
    components,
  };
}

function appendOrphanRowToItems(
  row: string[],
  headerRow: string[],
  nameCol: number,
  qtyCol: number,
  consistsCol: number,
  items: ParsedProductItem[],
): void {
  const refs = findUnitRefsInRow(row);
  for (const ref of refs) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.label.includes(ref)) {
        const additions: ParsedProductComponent[] = [];
        collectRowComponents(
          row,
          headerRow,
          nameCol,
          qtyCol,
          consistsCol,
          additions,
        );
        const mult = lineQtyFromLabel(items[i]!.label);
        for (const c of additions) {
          const per = Math.max(1, Math.floor(Number(c.quantity) || 1));
          c.quantity = per * mult;
        }
        items[i]!.components.push(...additions);
        return;
      }
    }
  }
}

function parseSheet(matrix: string[][], sheetName: string): ParsedProductItem[] {
  const productType = sheetProductType(sheetName);
  const instructionKind = sheetInstructionKind(sheetName);
  const headerIdx = findMainHeaderRow(matrix);
  let headerRow = [...(matrix[headerIdx] ?? [])].map((c) => norm(c));

  const nameCol = findCol(headerRow, (h) => h.includes('name of unit') || h.includes('name of window'));
  const qtyCol = findCol(headerRow, (h) => h.includes('quantity'));
  const consistsCol = findCol(headerRow, (h) => h.includes('consists of'));
  if (nameCol < 0 || qtyCol < 0) return [];

  const items: ParsedProductItem[] = [];
  let block: string[][] = [];
  let emptyStreak = 0;

  const flush = () => {
    const it = parseBlockToItem(block, headerRow, sheetName, productType, instructionKind);
    if (it && it.components.length) items.push(it);
    block = [];
  };

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];

    if (isEmptyRow(row)) {
      emptyStreak++;
      if (emptyStreak >= 2) {
        flush();
        emptyStreak = 0;
      }
      continue;
    }
    emptyStreak = 0;

    if (isSecondaryHeaderRow(row, nameCol, qtyCol)) {
      headerRow = mergeOverlayHeaders(headerRow, row);
      continue;
    }

    if (isPrimaryUnitRow(row, nameCol, qtyCol)) {
      flush();
      block.push(row);
      continue;
    }

    if (block.length && rowHasMeasurableValues(row, nameCol, qtyCol, consistsCol)) {
      block.push(row);
      continue;
    }

    if (
      !block.length &&
      items.length &&
      rowHasMeasurableValues(row, nameCol, qtyCol, consistsCol)
    ) {
      appendOrphanRowToItems(row, headerRow, nameCol, qtyCol, consistsCol, items);
    }
  }
  flush();
  return items;
}

/**
 * קובץ תפ״י (פורמט מחלקת תכנון): שורת כותרות עם Width/Height, NAME OF UNIT / NAME OF WINDOW,
 * QUANTITY, CONSISTS OF; בלוק שורות לכל יחידה; כותרות משנה (GYPSUM, SUBFRAME-Y …) מתמזגות לכותרות.
 */
export function parsePlanningWorkbook(buffer: Buffer): PlanningParseResult[] {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const results: PlanningParseResult[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][];
    const matrix = aoa.map((row) => row.map((c) => norm(c)));
    if (!matrix.length) continue;

    const items = parseSheet(matrix, sheetName);
    if (items.length) {
      results.push({ sheetName, items });
    }
  }

  return results;
}
