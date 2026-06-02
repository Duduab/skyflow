import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import type { ProductItem, ProductComponent } from '@prisma/client';
import {
  loadPlanningImportManifest,
  planningImportStorageDir,
  type PlanningSheetImagesManifest,
} from './planning-workbook-media';
import {
  imageRowDistanceToBlock,
  normalizeSheetTabName,
} from './planning-image-match.util';

export interface AssemblyItemImagesManifest {
  version: 1;
  itemImages: Record<string, string[]>;
}

export function ensureAssemblyCaptureDir(projectId: string): string {
  const dir = join(
    process.cwd(),
    '..',
    'web',
    'public',
    'planning-assembly',
    projectId,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function assemblyManifestPath(projectId: string): string {
  return join(ensureAssemblyCaptureDir(projectId), 'manifest.json');
}

export function loadAssemblyManifest(
  projectId: string,
): AssemblyItemImagesManifest | null {
  const p = assemblyManifestPath(projectId);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(
      readFileSync(p, 'utf8'),
    ) as AssemblyItemImagesManifest;
    if (j?.version === 1 && j.itemImages) return j;
  } catch {
    /* ignore */
  }
  return null;
}

export function displayLabelWithoutSheetPrefix(label: string): string {
  return label.replace(/^\[[^\]]+\]\s*/, '').trim();
}

export function lineQtyFromLabel(label: string): number {
  const m = label.match(/\((?:×|x)(\d+)\)/i);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sheetNameFromProductLabel(label: string): string {
  const m = label.match(/^\[([^\]]+)\]\s*/);
  return m ? m[1].trim() : '—';
}

function isWindowInstructionItem(item: Pick<ProductItem, 'instructionKind' | 'productType'>): boolean {
  return (
    item.instructionKind === 'WINDOW_INSTRUCTION' ||
    item.productType === 'WINDOW'
  );
}

/** מעתיק תמונות מטאב Window(s) instructions לפני מחיקת תיקיית הייבוא */
export function persistAssemblyPlanningMedia(
  projectId: string,
  items: (ProductItem & { components: ProductComponent[] })[],
  importManifest: PlanningSheetImagesManifest[],
): void {
  const importDir = planningImportStorageDir(projectId);
  const captureRoot = ensureAssemblyCaptureDir(projectId);
  try {
    rmSync(captureRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  mkdirSync(captureRoot, { recursive: true });

  const mediaBySheet = new Map(
    importManifest.map((m) => [normalizeSheetTabName(m.sheetName), m.images]),
  );

  const itemImages: Record<string, string[]> = {};
  const maxRowSkew = 22;
  let fileSeq = 0;

  for (const item of items) {
    if (!isWindowInstructionItem(item)) continue;
    const sheetTitle = sheetNameFromProductLabel(item.label);
    const raw = mediaBySheet.get(normalizeSheetTabName(sheetTitle));
    if (!raw?.length) continue;

    const rowS = item.planningBlockStartRow0 ?? 0;
    const rowE = item.planningBlockEndRow0 ?? rowS;
    const hits: typeof raw = [];
    for (const im of raw) {
      const d = imageRowDistanceToBlock(im.anchorRow, rowS, rowE);
      if (d <= maxRowSkew) hits.push(im);
    }
    const matched =
      hits.length > 0
        ? hits
        : [...raw].sort(
            (a, b) =>
              a.anchorRow - b.anchorRow || a.anchorCol - b.anchorCol,
          );
    matched.sort(
      (a, b) => a.anchorRow - b.anchorRow || a.anchorCol - b.anchorCol,
    );

    const paths: string[] = [];
    for (const im of matched) {
      const src = join(importDir, im.file);
      if (!existsSync(src)) continue;
      const ext = extname(im.file) || '.bin';
      const destName = `win-${fileSeq++}${ext}`;
      copyFileSync(src, join(captureRoot, destName));
      paths.push(`/planning-assembly/${projectId}/${destName}`);
    }
    if (paths.length) itemImages[item.id] = paths;
  }

  writeFileSync(
    assemblyManifestPath(projectId),
    JSON.stringify({ version: 1, itemImages } satisfies AssemblyItemImagesManifest),
    'utf8',
  );
}
