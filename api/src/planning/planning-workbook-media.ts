import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import JSZip from 'jszip';

export interface PlanningPreviewImageDto {
  /** נתיב יחסי לשרת ה-API (מוצג ב-`<img src>` — `/api/planning-imports/...`) */
  url: string;
  /** שורה בגליון Excel (0-based, כמו ב־OOXML) */
  anchorRow: number;
  /** עמודה (0-based) */
  anchorCol: number;
  /** שם האובייקט ב־Excel אם קיים */
  pictureName?: string;
}

export interface PlanningSheetImagesManifest {
  sheetName: string;
  images: {
    file: string;
    anchorRow: number;
    anchorCol: number;
    pictureName?: string;
  }[];
}

const MANIFEST = 'manifest.json';

function isZipBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

export function isXlsxZipBuffer(buf: Buffer): boolean {
  return isZipBuffer(buf);
}

/**
 * תיקיית אחסון לתמונות ייבוא תפ״י (בתוך שרת ה-API).
 * לא נשענים על `web/public` — כדי ש-`ng serve` / Vercel יגישו קבצים דינמיים דרך `/api/planning-imports/...`.
 */
export function planningImportStorageDir(projectId: string): string {
  return join(process.cwd(), 'storage', 'planning-imports', projectId);
}

/** שם קובץ תמונה בטוח לנתיב (רק קבצים שחילצנו בעצמנו) */
export function safePlanningImportFilename(name: string): string | null {
  const base = basename(name);
  return /^img-\d+\.(png|jpg|jpeg|gif|webp|bin)$/i.test(base) ? base : null;
}

function parseRelationshipIdTarget(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"[^/]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** יעד Relationship יחסית לתיקייה שמכילה את קובץ ה־.rels */
function resolveRelTarget(relsFilePath: string, target: string): string {
  const m = relsFilePath.match(/^(.*)_rels[/][^/]+\.rels$/);
  const baseDir = m ? m[1]! : relsFilePath.replace(/[/][^/]+$/, '');
  const segs = baseDir.split('/').filter(Boolean);
  for (const p of target.split('/')) {
    if (p === '..') segs.pop();
    else if (p && p !== '.') segs.push(p);
  }
  return segs.join('/');
}

function parseWorkbookSheets(wbXml: string): { name: string; rid: string }[] {
  const out: { name: string; rid: string }[] = [];
  const re = /<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wbXml)) !== null) {
    out.push({ name: m[1], rid: m[2] });
  }
  return out;
}

function extFromMediaPath(p: string): string {
  const m = p.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'bin';
}

function drawingRelsPath(drawingXmlPath: string): string {
  const dir = drawingXmlPath.replace(/[/][^/]+$/, '');
  const base = drawingXmlPath.split('/').pop() ?? 'drawing.xml';
  return `${dir}/_rels/${base}.rels`;
}

function parseDrawingAnchors(
  drawingXml: string,
  relsFilePath: string,
  relTargets: Map<string, string>,
): { anchorRow: number; anchorCol: number; embedId: string; pictureName?: string }[] {
  const out: {
    anchorRow: number;
    anchorCol: number;
    embedId: string;
    pictureName?: string;
  }[] = [];
  const blockRe =
    /<xdr:(?:twoCell|oneCell)Anchor[^>]*>([\s\S]*?)<\/xdr:(?:twoCell|oneCell)Anchor>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(drawingXml)) !== null) {
    const block = bm[1];
    const fromM = block.match(
      /<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/,
    );
    const embedM = block.match(/r:embed="(rId\d+)"/);
    if (!fromM || !embedM) continue;
    const nameM = block.match(/<xdr:cNvPr[^>]*name="([^"]*)"/);
    out.push({
      anchorCol: parseInt(fromM[1], 10),
      anchorRow: parseInt(fromM[2], 10),
      embedId: embedM[1],
      pictureName: nameM ? nameM[1] : undefined,
    });
  }
  return out;
}

function embedToMediaPath(
  embedId: string,
  relsFilePath: string,
  relTargets: Map<string, string>,
): string | null {
  const tgt = relTargets.get(embedId);
  if (!tgt) return null;
  return resolveRelTarget(relsFilePath, tgt);
}

/**
 * מחלץ תמונות מקובץ xlsx (OOXML), שומר תחת storage/planning-imports/{projectId}/
 * ומחזיר מפתחות URL לתצוגה מקדימה.
 */
export async function extractPlanningWorkbookImages(
  projectId: string,
  buffer: Buffer,
): Promise<PlanningSheetImagesManifest[]> {
  if (!isZipBuffer(buffer)) {
    return [];
  }

  const outDir = planningImportStorageDir(projectId);
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  mkdirSync(outDir, { recursive: true });

  const zip = await JSZip.loadAsync(buffer);

  const readText = async (path: string): Promise<string | null> => {
    const f = zip.file(path);
    if (!f) return null;
    return f.async('string');
  };
  const readBuf = async (path: string): Promise<Buffer | null> => {
    const f = zip.file(path);
    if (!f) return null;
    return f.async('nodebuffer');
  };

  const wbXml = await readText('xl/workbook.xml');
  const wbRelsXml = await readText('xl/_rels/workbook.xml.rels');
  if (!wbXml || !wbRelsXml) return [];

  const wbRels = parseRelationshipIdTarget(wbRelsXml);
  const sheets = parseWorkbookSheets(wbXml);
  const manifest: PlanningSheetImagesManifest[] = [];
  const mediaPathToFile = new Map<string, string>();
  let nextImg = 0;

  for (const sh of sheets) {
    const sheetTarget = wbRels.get(sh.rid);
    if (!sheetTarget) continue;
    const sheetPath = resolveRelTarget('xl/_rels/workbook.xml.rels', sheetTarget);
    const sheetXml = await readText(sheetPath);
    if (!sheetXml) {
      continue;
    }

    const drawM = sheetXml.match(/<drawing[^>]*r:id="([^"]+)"/);
    const sheetImages: PlanningSheetImagesManifest['images'] = [];

    if (drawM) {
      const sheetFile = sheetPath.split('/').pop() ?? 'sheet.xml';
      const sheetDir = sheetPath.replace(/[/][^/]+$/, '');
      const sheetRelsPath = `${sheetDir}/_rels/${sheetFile}.rels`;
      const sheetRelsXml = await readText(sheetRelsPath);
      if (sheetRelsXml) {
        const sheetRels = parseRelationshipIdTarget(sheetRelsXml);
        const drawingTarget = sheetRels.get(drawM[1]);
        if (drawingTarget) {
          const drawingPath = resolveRelTarget(sheetRelsPath, drawingTarget);
          const drawingXml = await readText(drawingPath);
          const drPath = drawingRelsPath(drawingPath);
          const drXml = await readText(drPath);
          if (drawingXml && drXml) {
            const drRels = parseRelationshipIdTarget(drXml);
            const anchors = parseDrawingAnchors(drawingXml, drPath, drRels);
            for (const a of anchors) {
              const mediaPath = embedToMediaPath(a.embedId, drPath, drRels);
              if (!mediaPath || !/^xl\/media\//i.test(mediaPath)) continue;
              let file = mediaPathToFile.get(mediaPath);
              if (!file) {
                const bin = await readBuf(mediaPath);
                if (!bin || bin.length < 8) continue;
                const ext = extFromMediaPath(mediaPath);
                file = `img-${nextImg++}.${ext}`;
                writeFileSync(join(outDir, file), bin);
                mediaPathToFile.set(mediaPath, file);
              }
              sheetImages.push({
                file,
                anchorRow: a.anchorRow,
                anchorCol: a.anchorCol,
                pictureName: a.pictureName,
              });
            }
          }
        }
      }
    }

    if (sheetImages.length) {
      manifest.push({ sheetName: sh.name, images: sheetImages });
    }
  }

  writeFileSync(
    join(outDir, MANIFEST),
    JSON.stringify({ version: 1, sheets: manifest }, null, 0),
    'utf8',
  );

  return manifest;
}

export function loadPlanningImportManifest(
  projectId: string,
): PlanningSheetImagesManifest[] {
  const dir = planningImportStorageDir(projectId);
  const p = join(dir, MANIFEST);
  try {
    const raw = readFileSync(p, 'utf8');
    const j = JSON.parse(raw) as { sheets?: PlanningSheetImagesManifest[] };
    return Array.isArray(j.sheets) ? j.sheets : [];
  } catch {
    return [];
  }
}

/** מוחק תיקיית ייבוא (למשל אחרי אישור / מחיקת פרויקט) — best-effort */
export function clearPlanningImportDir(projectId: string): void {
  const dir = planningImportStorageDir(projectId);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
