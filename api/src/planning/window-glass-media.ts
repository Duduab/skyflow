import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { GlassKind } from './pdf/window-glass-vision';

/**
 * On-disk store for the glass panel crops the gluing station shows. Mirrors the
 * `planning-assembly` media pattern: PNGs live under
 * `web/public/planning-glass/<projectId>/` and a manifest maps each window-type
 * code to its ordered glass panels. Kept out of the DB so no migration is
 * needed and the payload stays close to the served asset.
 */

export interface GlassPanelEntry {
  code: string;
  kind: GlassKind;
  /** Public URL, e.g. "/planning-glass/<projectId>/WT1-WM-1.png". */
  imagePath: string;
  order: number;
}

export interface GlassImagesManifest {
  version: 1;
  /** window-type code → ordered glass panels */
  byWindowType: Record<string, GlassPanelEntry[]>;
}

export function ensureGlassCaptureDir(projectId: string): string {
  const dir = join(
    process.cwd(),
    '..',
    'web',
    'public',
    'planning-glass',
    projectId,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function glassManifestPath(projectId: string): string {
  return join(ensureGlassCaptureDir(projectId), 'manifest.json');
}

export function loadGlassManifest(
  projectId: string,
): GlassImagesManifest | null {
  const p = glassManifestPath(projectId);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as GlassImagesManifest;
    if (j?.version === 1 && j.byWindowType) return j;
  } catch {
    /* ignore */
  }
  return null;
}

function saveGlassManifest(
  projectId: string,
  manifest: GlassImagesManifest,
): void {
  writeFileSync(glassManifestPath(projectId), JSON.stringify(manifest), 'utf8');
}

function safeName(code: string): string {
  return code.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/**
 * Persist the detected glass crops for one window type: write each PNG and
 * upsert the window type's entry in the manifest (replacing any previous run).
 */
export function saveGlassPanelsForWindowType(
  projectId: string,
  windowTypeCode: string,
  panels: { code: string; kind: GlassKind; pngBase64: string; order: number }[],
): GlassPanelEntry[] {
  const dir = ensureGlassCaptureDir(projectId);
  const manifest = loadGlassManifest(projectId) ?? {
    version: 1,
    byWindowType: {},
  };

  const entries: GlassPanelEntry[] = [];
  const wtName = safeName(windowTypeCode);
  panels.forEach((p, idx) => {
    const fileName = `${wtName}-${safeName(p.code)}-${idx}.png`;
    writeFileSync(join(dir, fileName), Buffer.from(p.pngBase64, 'base64'));
    entries.push({
      code: p.code,
      kind: p.kind,
      imagePath: `/planning-glass/${projectId}/${fileName}`,
      order: p.order,
    });
  });

  manifest.byWindowType[windowTypeCode] = entries;
  saveGlassManifest(projectId, manifest);
  return entries;
}
