import {
  ANGLE_CODE_EXACT_RE,
  ANGLE_CODE_RE,
  extractPdfFragments,
  fragsForPage,
  groupRows,
} from './pdf-text.util';

export interface ParsedAngle {
  /** e.g. ANG-1A */
  code: string;
  /** quantity to produce (e.g. 6980) */
  qty: number;
  /** 0-based page index where the angle instruction lives */
  page: number;
}

export interface ParsedAngles {
  pageCount: number;
  angles: ParsedAngle[];
}

/** Quantity for an angle = the integer sharing the code's row (ITEM | QUANTITY table). */
export async function parseAnglePdf(
  fileBuffer: Buffer,
): Promise<ParsedAngles> {
  const { pageCount, frags } = await extractPdfFragments(fileBuffer);
  const angles: ParsedAngle[] = [];
  const seen = new Set<string>();

  for (let p = 1; p <= pageCount; p += 1) {
    const pageFrags = fragsForPage(frags, p);
    const rows = groupRows(pageFrags, 5);

    for (const row of rows) {
      const codeFrag = row.find((f) => ANGLE_CODE_EXACT_RE.test(f.str));
      if (!codeFrag) continue;
      const code = codeFrag.str.toUpperCase();
      if (seen.has(code)) continue;

      // quantity = the largest integer on the same row (skip small dimension noise)
      const ints = row
        .filter(
          (f) => /^\d+$/.test(f.str) && f.cx > codeFrag.cx - 4,
        )
        .map((f) => parseInt(f.str, 10));
      const qty = ints.length ? Math.max(...ints) : 0;
      angles.push({ code, qty, page: p - 1 });
      seen.add(code);
    }
  }

  // Fallback: no ITEM/QUANTITY rows — scan whole doc for a code + trailing number.
  if (!angles.length) {
    const joined = frags.map((f) => f.str).join(' ');
    const m = ANGLE_CODE_RE.exec(joined);
    if (m) {
      angles.push({ code: m[1].toUpperCase(), qty: 0, page: 0 });
    }
  }

  return { pageCount, angles };
}
