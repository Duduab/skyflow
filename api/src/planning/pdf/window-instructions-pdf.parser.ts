import {
  ANGLE_CODE_RE,
  extractPdfFragments,
  fragsForPage,
  WINDOW_CODE_EXACT_RE,
  WINDOW_CODE_RE,
  type TextFrag,
} from './pdf-text.util';

export interface ParsedWindowType {
  /** e.g. 74-1-03A */
  code: string;
  /** 0-based page index where this window's instructions begin */
  startPage: number;
  /** all page indices (0-based) covered by this window */
  pages: number[];
  /** true when an ANG angle appears in this window */
  hasAngles: boolean;
  /** ANG codes referenced by this window's frame */
  angleCodes: string[];
  /** best-effort composition labels detected (spandrel/window/fixed/shadow box) */
  composition: string[];
  /** set-table labels detected (shokonim / profiles / seals / accessories) */
  setLabels: string[];
}

export interface ParsedWindowInstructions {
  pageCount: number;
  windows: ParsedWindowType[];
}

const COMPOSITION_HINTS: { re: RegExp; label: string }[] = [
  { re: /shadow\s*box/i, label: 'SHADOW_BOX' },
  { re: /spandrel|SP-\d/i, label: 'SPANDREL' },
  { re: /glass\s*\+\s*window|window/i, label: 'WINDOW' },
  { re: /fixed|קבוע/i, label: 'FIXED' },
];

const SET_HINTS: { re: RegExp; label: string }[] = [
  { re: /שוקונ|תושב/, label: 'SHOKONIM_MOUNTS' },
  { re: /פרופיל/, label: 'PROFILES' },
  { re: /אטמ/, label: 'SEALS' },
  { re: /אביזר/, label: 'ACCESSORIES' },
];

function pageHasWindowNameHeader(pageFrags: TextFrag[]): boolean {
  const joined = pageFrags.map((f) => f.str.toUpperCase()).join(' ');
  return joined.includes('WINDOW NAME') || joined.includes('WINDOWS');
}

/** The window code near the "WINDOW NAME" label (bottom sub-table of page 1). */
function pageWindowCode(pageFrags: TextFrag[]): string | null {
  const exact = pageFrags.find((f) => WINDOW_CODE_EXACT_RE.test(f.str));
  if (exact) return exact.str;
  for (const f of pageFrags) {
    const m = WINDOW_CODE_RE.exec(f.str);
    if (m) return m[1];
  }
  return null;
}

export async function parseWindowInstructionsPdf(
  fileBuffer: Buffer,
): Promise<ParsedWindowInstructions> {
  const { pageCount, frags } = await extractPdfFragments(fileBuffer);
  const windows: ParsedWindowType[] = [];
  let current: ParsedWindowType | null = null;

  for (let p = 1; p <= pageCount; p += 1) {
    const pageFrags = fragsForPage(frags, p);
    const pageIndex = p - 1;
    const code = pageWindowCode(pageFrags);
    const hasHeader = pageHasWindowNameHeader(pageFrags);

    const currentCode: string | null = current ? current.code : null;
    const startsNew = !!code && hasHeader && code !== currentCode;
    if (startsNew) {
      current = {
        code: code!,
        startPage: pageIndex,
        pages: [pageIndex],
        hasAngles: false,
        angleCodes: [],
        composition: [],
        setLabels: [],
      };
      windows.push(current);
    } else if (current) {
      current.pages.push(pageIndex);
    } else if (code) {
      // first page without a WINDOW NAME header but has a code
      current = {
        code,
        startPage: pageIndex,
        pages: [pageIndex],
        hasAngles: false,
        angleCodes: [],
        composition: [],
        setLabels: [],
      };
      windows.push(current);
    }

    if (!current) continue;

    const joined = pageFrags.map((f) => f.str).join(' ');
    // ANG references
    const angleSet = new Set(current.angleCodes);
    const angRe = new RegExp(ANGLE_CODE_RE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = angRe.exec(joined)) !== null) {
      angleSet.add(m[1].toUpperCase());
    }
    current.angleCodes = [...angleSet];
    current.hasAngles = current.angleCodes.length > 0;

    // composition hints
    const compSet = new Set(current.composition);
    for (const hint of COMPOSITION_HINTS) {
      if (hint.re.test(joined)) compSet.add(hint.label);
    }
    current.composition = [...compSet];

    // set-table hints
    const setSet = new Set(current.setLabels);
    for (const hint of SET_HINTS) {
      if (hint.re.test(joined)) setSet.add(hint.label);
    }
    current.setLabels = [...setSet];
  }

  return { pageCount, windows };
}
