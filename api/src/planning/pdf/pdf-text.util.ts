import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

type Matrix = [number, number, number, number, number, number];

/** A single positioned text fragment extracted from a PDF (scale-1 device space). */
export interface TextFrag {
  str: string;
  /** left x */
  x: number;
  /** center x */
  cx: number;
  /** baseline y (top-down device space) */
  y: number;
  w: number;
  h: number;
  /** 1-based page number */
  page: number;
}

export interface ExtractedPdf {
  pageCount: number;
  frags: TextFrag[];
}

/** PDF text may render Hebrew reversed; flip pure-Hebrew tokens back. */
export function fixRtl(s: string): string {
  const hasHebrew = /[\u0590-\u05FF]/.test(s);
  const hasLatin = /[A-Za-z0-9]/.test(s);
  if (hasHebrew && !hasLatin) {
    return s.split('').reverse().join('');
  }
  return s;
}

/** Extract every positioned text fragment across all pages. */
export async function extractPdfFragments(
  fileBuffer: Buffer,
): Promise<ExtractedPdf> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer) })
    .promise;
  try {
    const frags: TextFrag[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const m = Array.from(viewport.transform) as Matrix;
      const tc = await page.getTextContent();
      for (const item of tc.items) {
        const raw = (item as { str?: string }).str;
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const transform = (item as { transform: number[] }).transform;
        const width = (item as { width?: number }).width ?? 0;
        const height = (item as { height?: number }).height ?? 10;
        const mapped = pdfjs.Util.transform(m, transform) as number[];
        frags.push({
          str: raw.trim(),
          x: mapped[4],
          cx: mapped[4] + width / 2,
          y: mapped[5],
          w: width,
          h: Math.max(6, height),
          page: p,
        });
      }
    }
    return { pageCount: doc.numPages, frags };
  } finally {
    await doc.destroy();
  }
}

/** Fragments belonging to a single page. */
export function fragsForPage(all: TextFrag[], page: number): TextFrag[] {
  return all.filter((f) => f.page === page);
}

/** Group fragments into visual rows by baseline y; each row is left-to-right sorted. */
export function groupRows(frags: TextFrag[], tol = 4): TextFrag[][] {
  const sorted = [...frags].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextFrag[][] = [];
  for (const f of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(f.y - last[0].y) <= Math.max(tol, last[0].h * 0.6)) {
      last.push(f);
    } else {
      rows.push([f]);
    }
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

/** Assign a value's center-x to the nearest column center; returns column index or -1. */
export function nearestColumn(cx: number, columnCx: number[]): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < columnCx.length; i += 1) {
    const d = Math.abs(cx - columnCx[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Window/unit type code, e.g. 74-1-03A or 74-1-04. */
export const WINDOW_CODE_RE = /\b(\d{2}-\d-\d{2}[A-Z]?)\b/;
export const WINDOW_CODE_EXACT_RE = /^\d{2}-\d-\d{2}[A-Z]?$/;
/** Angle code, e.g. ANG-1A / ANG-12 */
export const ANGLE_CODE_RE = /\b(ANG-\w+)\b/i;
export const ANGLE_CODE_EXACT_RE = /^ANG-\w+$/i;
/** Facade label, e.g. S-w, S1-e, N5-w, W4, E10 */
export const FACADE_LABEL_RE = /^[NSWE]\d*(?:-[we])?$/i;
