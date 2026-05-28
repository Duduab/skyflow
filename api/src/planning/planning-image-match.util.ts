import {
  PlanningSheetImagesManifest,
  PlanningPreviewImageDto,
} from './planning-workbook-media';

export function normalizeSheetTabName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** מרחק אנכי משורת תמונה לטווח שורות בלוק יחידה (0 = בתוך הטווח) */
export function imageRowDistanceToBlock(
  anchorRow: number,
  blockStart: number,
  blockEnd: number,
): number {
  if (anchorRow < blockStart) return blockStart - anchorRow;
  if (anchorRow > blockEnd) return anchorRow - blockEnd;
  return 0;
}

export function previewImageDto(
  projectId: string,
  im: {
    file: string;
    anchorRow: number;
    anchorCol: number;
    pictureName?: string;
  },
): PlanningPreviewImageDto {
  return {
    url: `/api/planning-imports/${projectId}/${im.file}`,
    anchorRow: im.anchorRow,
    anchorCol: im.anchorCol,
    pictureName: im.pictureName,
  };
}

export function pickPlanningImagesForColumn(
  manifest: PlanningSheetImagesManifest[],
  sheetTitle: string,
  col0: number,
  rowStart: number,
  rowEnd: number,
  maxSkew: number,
): PlanningSheetImagesManifest['images'] {
  const key = normalizeSheetTabName(sheetTitle);
  const sheet = manifest.find(
    (m) => normalizeSheetTabName(m.sheetName) === key,
  );
  if (!sheet) return [];
  const hits: PlanningSheetImagesManifest['images'] = [];
  for (const im of sheet.images) {
    if (im.anchorCol !== col0) continue;
    const d = imageRowDistanceToBlock(im.anchorRow, rowStart, rowEnd);
    if (d <= maxSkew) hits.push(im);
  }
  hits.sort(
    (a, b) => a.anchorRow - b.anchorRow || a.anchorCol - b.anchorCol,
  );
  return hits;
}

export function componentToPreviewLine(c: {
  kind: string;
  description: string;
  spec: string | null;
  quantity: number;
}): string {
  const spec = c.spec?.trim();
  const base = spec
    ? `${c.kind}: ${c.description} — ${spec}`
    : `${c.kind}: ${c.description}`;
  const q = Math.max(1, Math.floor(Number(c.quantity) || 1));
  if (q > 1) return `${base} · ×${q}`;
  return base;
}

export interface PlanningPreviewComponentCardDto {
  label: string;
  image?: PlanningPreviewImageDto;
}

/** בונה כרטיסי רכיב עם שיוך תמונה לפי עמודה בגליון, ואז מתוך מאגר התמונות של השורה */
export function buildRowComponentCards(
  projectId: string,
  sheetName: string,
  components: {
    kind: string;
    description: string;
    spec: string | null;
    quantity: number;
    planningSourceCol0: number | null;
  }[],
  blockStart: number | null,
  blockEnd: number | null,
  rowImages: PlanningPreviewImageDto[],
  manifest: PlanningSheetImagesManifest[],
  maxLines: number,
  overflowExtraCount: number,
): {
  cards: PlanningPreviewComponentCardDto[];
  extraImages: PlanningPreviewImageDto[];
} {
  const cards: PlanningPreviewComponentCardDto[] = [];
  const usedFiles = new Set<string>();
  const usedUrls = new Set<string>();

  const rowStart = blockStart ?? 0;
  const rowEnd = blockEnd ?? rowStart;
  const maxSkew = 22;

  for (const c of components.slice(0, maxLines)) {
    let image: PlanningPreviewImageDto | undefined;
    if (c.planningSourceCol0 != null && blockStart != null && blockEnd != null) {
      const hits = pickPlanningImagesForColumn(
        manifest,
        sheetName,
        c.planningSourceCol0,
        rowStart,
        rowEnd,
        maxSkew,
      );
      const hit = hits.find((h) => !usedFiles.has(h.file));
      if (hit) {
        image = previewImageDto(projectId, hit);
        usedFiles.add(hit.file);
        usedUrls.add(image.url);
      }
    }
    cards.push({ label: componentToPreviewLine(c), image });
  }

  if (overflowExtraCount > 0) {
    cards.push({
      label: `… +${overflowExtraCount} רכיבים נוספים`,
    });
  }

  const pool = [...rowImages].sort(
    (a, b) =>
      a.anchorRow - b.anchorRow ||
      a.anchorCol - b.anchorCol ||
      (a.pictureName ?? '').localeCompare(b.pictureName ?? ''),
  );

  for (const card of cards) {
    if (card.image) continue;
    const next = pool.find((im) => !usedUrls.has(im.url));
    if (!next) break;
    card.image = next;
    usedUrls.add(next.url);
  }

  const extraImages = pool.filter((im) => !usedUrls.has(im.url));
  return { cards, extraImages };
}
