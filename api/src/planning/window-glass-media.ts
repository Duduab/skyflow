import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import type { GlassKind } from './pdf/window-glass-vision';
import { runExclusive } from '../common/concurrency.util';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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

export function glassCaptureDirPath(projectId: string): string {
  return join(process.cwd(), '..', 'web', 'public', 'planning-glass', projectId);
}

export async function ensureGlassCaptureDir(projectId: string): Promise<string> {
  const dir = glassCaptureDirPath(projectId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function glassManifestPath(projectId: string): string {
  return join(glassCaptureDirPath(projectId), 'manifest.json');
}

export async function loadGlassManifest(
  projectId: string,
): Promise<GlassImagesManifest | null> {
  const p = glassManifestPath(projectId);
  try {
    const j = JSON.parse(await readFile(p, 'utf8')) as GlassImagesManifest;
    if (j?.version === 1 && j.byWindowType) return j;
  } catch {
    /* missing file or invalid JSON — caller falls back to an empty manifest */
  }
  return null;
}

async function saveGlassManifest(
  projectId: string,
  manifest: GlassImagesManifest,
): Promise<void> {
  await writeFile(glassManifestPath(projectId), JSON.stringify(manifest), 'utf8');
}

function safeName(code: string): string {
  return code.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/**
 * Persist the detected glass crops for one window type: write each PNG and
 * upsert the window type's entry in the manifest (replacing any previous run).
 *
 * The manifest is a shared read-modify-write file per project, so concurrent
 * calls for different window types of the SAME project (the planning pipeline
 * now processes a few windows concurrently) are serialized with `runExclusive`
 * — otherwise two concurrent writers could race and silently drop each
 * other's entries.
 */
export async function saveGlassPanelsForWindowType(
  projectId: string,
  windowTypeCode: string,
  panels: { code: string; kind: GlassKind; pngBase64: string; order: number }[],
): Promise<GlassPanelEntry[]> {
  const dir = await ensureGlassCaptureDir(projectId);
  const wtName = safeName(windowTypeCode);

  const entries: GlassPanelEntry[] = await Promise.all(
    panels.map(async (p, idx) => {
      const fileName = `${wtName}-${safeName(p.code)}-${idx}.png`;
      await writeFile(join(dir, fileName), Buffer.from(p.pngBase64, 'base64'));
      return {
        code: p.code,
        kind: p.kind,
        imagePath: `/planning-glass/${projectId}/${fileName}`,
        order: p.order,
      };
    }),
  );

  await runExclusive(`glass-manifest:${projectId}`, async () => {
    const manifest = (await loadGlassManifest(projectId)) ?? {
      version: 1,
      byWindowType: {},
    };
    manifest.byWindowType[windowTypeCode] = entries;
    await saveGlassManifest(projectId, manifest);
  });

  return entries;
}

function panelFileName(windowTypeCode: string, panelCode: string, order: number): string {
  return `${safeName(windowTypeCode)}-${safeName(panelCode)}-${order}.png`;
}

function assertValidPanelCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) throw new BadRequestException('Glass panel code is required');
  return trimmed;
}

function assertUniquePanelCode(
  panels: GlassPanelEntry[],
  code: string,
  exceptOrder?: number,
): void {
  if (panels.some((p) => p.order !== exceptOrder && p.code === code)) {
    throw new BadRequestException(`Glass panel code "${code}" already exists`);
  }
}

/**
 * Update one glass panel's code and/or kind. Renames the PNG on disk when the
 * code changes so the public URL stays in sync with the manifest entry.
 */
export async function updateGlassPanel(
  projectId: string,
  windowTypeCode: string,
  panelOrder: number,
  patch: { code?: string; kind?: GlassKind },
): Promise<GlassPanelEntry[]> {
  return runExclusive(`glass-manifest:${projectId}`, async () => {
    const manifest = (await loadGlassManifest(projectId)) ?? {
      version: 1,
      byWindowType: {},
    };
    const panels = manifest.byWindowType[windowTypeCode];
    if (!panels?.length) {
      throw new NotFoundException(`No glass panels for window type ${windowTypeCode}`);
    }

    const idx = panels.findIndex((p) => p.order === panelOrder);
    if (idx < 0) {
      throw new NotFoundException(`Glass panel order ${panelOrder} not found`);
    }

    const panel = panels[idx];
    const dir = glassCaptureDirPath(projectId);
    const nextCode =
      patch.code !== undefined ? assertValidPanelCode(patch.code) : panel.code;
    const nextKind = patch.kind ?? panel.kind;

    assertUniquePanelCode(panels, nextCode, panel.order);

    if (nextCode !== panel.code) {
      const oldFile = panel.imagePath.split('/').pop();
      const newFile = panelFileName(windowTypeCode, nextCode, panel.order);
      if (oldFile && oldFile !== newFile) {
        try {
          await rename(join(dir, oldFile), join(dir, newFile));
        } catch {
          /* keep going — manifest update is the source of truth */
        }
      }
      panel.imagePath = `/planning-glass/${projectId}/${newFile}`;
      panel.code = nextCode;
    }

    panel.kind = nextKind;
    panels.sort((a, b) => a.order - b.order);
    manifest.byWindowType[windowTypeCode] = panels;
    await saveGlassManifest(projectId, manifest);
    return panels;
  });
}

/** Remove one glass panel and delete its PNG from disk. */
export async function deleteGlassPanel(
  projectId: string,
  windowTypeCode: string,
  panelOrder: number,
): Promise<GlassPanelEntry[]> {
  return runExclusive(`glass-manifest:${projectId}`, async () => {
    const manifest = (await loadGlassManifest(projectId)) ?? {
      version: 1,
      byWindowType: {},
    };
    const panels = manifest.byWindowType[windowTypeCode];
    if (!panels?.length) {
      throw new NotFoundException(`No glass panels for window type ${windowTypeCode}`);
    }

    const panel = panels.find((p) => p.order === panelOrder);
    if (!panel) {
      throw new NotFoundException(`Glass panel order ${panelOrder} not found`);
    }

    const dir = glassCaptureDirPath(projectId);
    const fileName = panel.imagePath.split('/').pop();
    if (fileName) {
      try {
        await unlink(join(dir, fileName));
      } catch {
        /* file may already be gone */
      }
    }

    const remaining = panels
      .filter((p) => p.order !== panelOrder)
      .sort((a, b) => a.order - b.order);
    manifest.byWindowType[windowTypeCode] = remaining;
    await saveGlassManifest(projectId, manifest);
    return remaining;
  });
}
