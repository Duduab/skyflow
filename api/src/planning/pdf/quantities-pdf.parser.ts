import {
  extractPdfFragments,
  FACADE_LABEL_RE,
  fixRtl,
  fragsForPage,
  groupRows,
  nearestColumn,
  WINDOW_CODE_EXACT_RE,
  type TextFrag,
} from './pdf-text.util';

export interface ParsedFacadeRow {
  /** e.g. S-w, N2-e, W4 */
  label: string;
  /** windowTypeCode -> qty */
  qtys: Record<string, number>;
  total: number | null;
}

export interface ParsedStageRow {
  /** e.g. A, B, C */
  code: string;
  colorHex: string | null;
  /** windowTypeCode -> qty */
  qtys: Record<string, number>;
}

export interface ParsedQuantities {
  /** window-type codes in column order */
  windowTypes: string[];
  facades: ParsedFacadeRow[];
  /** windowTypeCode -> project total (from the "סה״כ" row) */
  totals: Record<string, number>;
  stages: ParsedStageRow[];
  /** total windows in project (tender) */
  projectTotal: number | null;
}

const TOTAL_LABEL_KEY = '__TOTAL__';

function isInt(s: string): boolean {
  return /^\d+$/.test(s);
}

/** Detect the header row that carries the most window-type codes. */
function findHeaderRow(rows: TextFrag[][]): {
  columns: string[];
  columnCx: number[];
  totalCx: number | null;
  rowIndex: number;
} | null {
  let best: { idx: number; codes: TextFrag[] } | null = null;
  rows.forEach((row, idx) => {
    const codes = row.filter((f) => WINDOW_CODE_EXACT_RE.test(f.str));
    if (codes.length >= 3 && (!best || codes.length > best.codes.length)) {
      best = { idx, codes };
    }
  });
  if (!best) return null;
  const chosen: { idx: number; codes: TextFrag[] } = best;
  const sortedCodes = [...chosen.codes].sort((a, b) => a.cx - b.cx);
  // The "total" column header is the Hebrew label to the right of the codes.
  const maxCodeCx = Math.max(...sortedCodes.map((c) => c.cx));
  const totalFrag = rows[chosen.idx]
    .filter((f) => f.cx > maxCodeCx && /[\u0590-\u05FF]/.test(f.str))
    .sort((a, b) => a.cx - b.cx)[0];
  return {
    columns: sortedCodes.map((c) => c.str),
    columnCx: sortedCodes.map((c) => c.cx),
    totalCx: totalFrag ? totalFrag.cx : null,
    rowIndex: chosen.idx,
  };
}

/** Map numeric fragments in a row to window-type columns (+ optional total). */
function mapRowNumbers(
  numbers: TextFrag[],
  columns: string[],
  columnCx: number[],
  totalCx: number | null,
): { qtys: Record<string, number>; total: number | null } {
  const allCx = totalCx != null ? [...columnCx, totalCx] : columnCx;
  const qtys: Record<string, number> = {};
  let total: number | null = null;
  for (const num of numbers) {
    const idx = nearestColumn(num.cx, allCx);
    if (idx < 0) continue;
    const value = parseInt(num.str, 10);
    if (totalCx != null && idx === columns.length) {
      total = value;
    } else if (columns[idx]) {
      qtys[columns[idx]] = (qtys[columns[idx]] ?? 0) + value;
    }
  }
  return { qtys, total };
}

export async function parseQuantitiesPdf(
  fileBuffer: Buffer,
): Promise<ParsedQuantities> {
  const { frags } = await extractPdfFragments(fileBuffer);
  // The quantities matrix lives on page 1.
  const pageFrags = fragsForPage(frags, 1);
  const rows = groupRows(pageFrags, 5);

  const header = findHeaderRow(rows);
  if (!header) {
    return {
      windowTypes: [],
      facades: [],
      totals: {},
      stages: [],
      projectTotal: null,
    };
  }

  const { columns, columnCx, totalCx, rowIndex } = header;
  const facades: ParsedFacadeRow[] = [];
  const totals: Record<string, number> = {};
  const stages: ParsedStageRow[] = [];
  let projectTotal: number | null = null;

  for (let i = rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.length) continue;
    const first = fixRtl(row[0].str);
    const numbers = row.filter((f) => isInt(f.str));

    // Stage row: "Stage A ..."
    const stageMatch = /^stage\s*([a-z0-9]+)/i.exec(
      row
        .map((f) => f.str)
        .slice(0, 2)
        .join(' '),
    );
    if (stageMatch) {
      const stageNumbers = numbers.filter(
        (f) => !/^stage$/i.test(f.str),
      );
      const { qtys } = mapRowNumbers(stageNumbers, columns, columnCx, totalCx);
      stages.push({
        code: stageMatch[1].toUpperCase(),
        colorHex: null,
        qtys,
      });
      continue;
    }

    // Totals row: starts with Hebrew "סה״כ"
    if (/סה/.test(first) || /סה/.test(row[0].str)) {
      const { qtys } = mapRowNumbers(numbers, columns, columnCx, totalCx);
      Object.assign(totals, qtys);
      continue;
    }

    // Facade row: label like S-w / N2-e / W4
    if (FACADE_LABEL_RE.test(row[0].str)) {
      const facadeNumbers = numbers;
      const { qtys, total } = mapRowNumbers(
        facadeNumbers,
        columns,
        columnCx,
        totalCx,
      );
      facades.push({ label: row[0].str, qtys, total });
      continue;
    }

    // Standalone big integer below the stages → project total (tender).
    if (numbers.length === 1 && projectTotal == null && stages.length > 0) {
      const v = parseInt(numbers[0].str, 10);
      if (v > 100) projectTotal = v;
    }
  }

  // Fill totals from facade sums when the totals row was not detected.
  if (!Object.keys(totals).length && facades.length) {
    for (const code of columns) {
      let sum = 0;
      for (const f of facades) sum += f.qtys[code] ?? 0;
      if (sum) totals[code] = sum;
    }
  }

  return {
    windowTypes: columns,
    facades,
    totals,
    stages,
    projectTotal,
  };
}

export { TOTAL_LABEL_KEY };
