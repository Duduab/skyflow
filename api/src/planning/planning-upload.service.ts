import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectFlowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parsePlanningWorkbook } from './planning-excel.parser';
import {
  clearPlanningImportDir,
  extractPlanningWorkbookImages,
  isXlsxZipBuffer,
  loadPlanningImportManifest,
} from './planning-workbook-media';

const PREVIEW_MAX_COMPONENT_LINES = 18;

function sheetNameFromProductLabel(label: string): string {
  const m = label.match(/^\[([^\]]+)\]\s*/);
  return m ? m[1].trim() : '—';
}

function normalizeSheetTabName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function displayLabelWithoutSheetPrefix(label: string): string {
  return label.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function componentToPreviewLine(c: {
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

/** מרחק אנכי משורת תמונה לטווח שורות בלוק יחידה (0 = בתוך הטווח) */
function imageRowDistanceToBlock(
  anchorRow: number,
  blockStart: number,
  blockEnd: number,
): number {
  if (anchorRow < blockStart) return blockStart - anchorRow;
  if (anchorRow > blockEnd) return anchorRow - blockEnd;
  return 0;
}

function previewImageDto(
  projectId: string,
  im: {
    file: string;
    anchorRow: number;
    anchorCol: number;
    pictureName?: string;
  },
) {
  return {
    url: `/api/planning-imports/${projectId}/${im.file}`,
    anchorRow: im.anchorRow,
    anchorCol: im.anchorCol,
    pictureName: im.pictureName,
  };
}

@Injectable()
export class PlanningUploadService {
  constructor(private readonly prisma: PrismaService) {}

  async replaceParsedData(projectId: string, buffer: Buffer) {
    const order = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
    });
    if (!order) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (order.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning file can only be updated while project is pending planning approval',
      );
    }

    const sheets = parsePlanningWorkbook(buffer);
    const flatItems = sheets.flatMap((s) => s.items);
    if (!flatItems.length) {
      throw new BadRequestException(
        'No planning rows found — check file format (headers after metadata rows)',
      );
    }

    if (isXlsxZipBuffer(buffer)) {
      await extractPlanningWorkbookImages(projectId, buffer);
    } else {
      clearPlanningImportDir(projectId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productItem.deleteMany({ where: { projectId } });

      let sortOrder = 0;
      for (const sheet of sheets) {
        for (const item of sheet.items) {
          await tx.productItem.create({
            data: {
              projectId,
              productType: item.productType,
              instructionKind: item.instructionKind,
              label: item.label,
              sortOrder: sortOrder++,
              planningBlockStartRow0: item.planningBlockStartRow0 ?? null,
              planningBlockEndRow0: item.planningBlockEndRow0 ?? null,
              components: {
                create: item.components.map((c) => ({
                  kind: c.kind,
                  description: c.description,
                  quantity: c.quantity,
                  spec: c.spec,
                })),
              },
            },
          });
        }
      }

      const totalItems = Math.max(1, flatItems.length);
      const lenNum = Number(order.originalLength);
      const refLen =
        Number.isFinite(lenNum) && lenNum > 0
          ? order.originalLength
          : new Prisma.Decimal(600);

      await tx.projectOrder.update({
        where: { id: projectId },
        data: {
          totalItems,
          originalLength: refLen,
          requirements:
            order.requirements?.trim() ||
            `Imported planning (${sheets.map((s) => s.sheetName).join(', ')})`,
        },
      });
    });

    return this.buildPreview(projectId);
  }

  async buildPreview(projectId: string) {
    const items = await this.prisma.productItem.findMany({
      where: { projectId },
      include: { components: true },
      orderBy: { sortOrder: 'asc' },
    });
    let totalUnits = 0;
    let totalWindows = 0;
    let totalComponents = 0;
    for (const it of items) {
      if (it.productType === 'UNIT') totalUnits++;
      else totalWindows++;
      for (const c of it.components) {
        totalComponents += c.quantity;
      }
    }

    const manifestSheets = loadPlanningImportManifest(projectId);
    const mediaBySheet = new Map(
      manifestSheets.map((m) => [
        normalizeSheetTabName(m.sheetName),
        m.images,
      ]),
    );

    const sheetOrder: string[] = [];
    const rowsBySheet = new Map<
      string,
      {
        unitCount: number;
        windowCount: number;
        rows: {
          displayLabel: string;
          instructionKind: string;
          productType: string;
          componentCount: number;
          componentLines: string[];
          planningBlockStartRow0: number | null;
          planningBlockEndRow0: number | null;
          images?: ReturnType<typeof previewImageDto>[];
        }[];
        orphanImages?: ReturnType<typeof previewImageDto>[];
      }
    >();

    for (const it of items) {
      const sheet = sheetNameFromProductLabel(it.label);
      if (!rowsBySheet.has(sheet)) {
        rowsBySheet.set(sheet, {
          unitCount: 0,
          windowCount: 0,
          rows: [],
        });
        sheetOrder.push(sheet);
      }
      const bucket = rowsBySheet.get(sheet)!;
      if (it.productType === 'UNIT') bucket.unitCount++;
      else bucket.windowCount++;

      const lines = it.components
        .slice(0, PREVIEW_MAX_COMPONENT_LINES)
        .map((c) => componentToPreviewLine(c));
      if (it.components.length > PREVIEW_MAX_COMPONENT_LINES) {
        lines.push(
          `… +${it.components.length - PREVIEW_MAX_COMPONENT_LINES} רכיבים נוספים`,
        );
      }
      let compQty = 0;
      for (const c of it.components) compQty += c.quantity;

      bucket.rows.push({
        displayLabel: displayLabelWithoutSheetPrefix(it.label),
        instructionKind: it.instructionKind,
        productType: it.productType,
        componentCount: compQty,
        componentLines: lines,
        planningBlockStartRow0: it.planningBlockStartRow0 ?? null,
        planningBlockEndRow0: it.planningBlockEndRow0 ?? null,
      });
    }

    const seenNorm = new Set(sheetOrder.map(normalizeSheetTabName));
    for (const m of manifestSheets) {
      const k = normalizeSheetTabName(m.sheetName);
      if (!seenNorm.has(k) && m.images.length) {
        sheetOrder.push(m.sheetName);
        rowsBySheet.set(m.sheetName, {
          unitCount: 0,
          windowCount: 0,
          rows: [],
        });
        seenNorm.add(k);
      }
    }

    for (const sheetName of sheetOrder) {
      const b = rowsBySheet.get(sheetName)!;
      const raw = mediaBySheet.get(normalizeSheetTabName(sheetName));
      if (!raw?.length) continue;

      /** מרחק מקסימלי (בשורות גליון) בין תמונה לבלוק יחידה — כדי לשייך סקיצות שנמצאות מעט מעל/מתחת לשורות ה-BOM */
      const maxRowSkew = 22;
      const orphans: (typeof raw)[number][] = [];

      for (const im of raw) {
        let bestI = -1;
        let bestD = Infinity;
        for (let i = 0; i < b.rows.length; i++) {
          const row = b.rows[i]!;
          if (
            row.planningBlockStartRow0 == null ||
            row.planningBlockEndRow0 == null
          ) {
            continue;
          }
          const d = imageRowDistanceToBlock(
            im.anchorRow,
            row.planningBlockStartRow0,
            row.planningBlockEndRow0,
          );
          if (d < bestD) {
            bestD = d;
            bestI = i;
          } else if (d === bestD && bestI >= 0) {
            const curS = row.planningBlockStartRow0!;
            const bestS = b.rows[bestI]!.planningBlockStartRow0!;
            if (curS < bestS) bestI = i;
          }
        }
        if (bestI < 0 || bestD > maxRowSkew) {
          orphans.push(im);
          continue;
        }
        const tgt = b.rows[bestI]!;
        if (!tgt.images) tgt.images = [];
        tgt.images.push(previewImageDto(projectId, im));
      }

      for (const row of b.rows) {
        if (row.images?.length) {
          row.images.sort(
            (a, c) =>
              a.anchorRow - c.anchorRow ||
              a.anchorCol - c.anchorCol ||
              (a.pictureName ?? '').localeCompare(c.pictureName ?? ''),
          );
        }
      }

      if (orphans.length) {
        b.orphanImages = orphans
          .sort(
            (a, c) =>
              a.anchorRow - c.anchorRow ||
              a.anchorCol - c.anchorCol ||
              (a.pictureName ?? '').localeCompare(c.pictureName ?? ''),
          )
          .map((im) => previewImageDto(projectId, im));
      }
    }

    const sheets = sheetOrder.map((sheetName) => {
      const b = rowsBySheet.get(sheetName)!;
      return {
        sheetName,
        unitCount: b.unitCount,
        windowCount: b.windowCount,
        itemCount: b.rows.length,
        rows: b.rows.map(
          ({
            planningBlockStartRow0: _rs,
            planningBlockEndRow0: _re,
            ...row
          }) => row,
        ),
        images: b.orphanImages?.length ? b.orphanImages : undefined,
      };
    });

    return {
      projectId,
      totalUnits,
      totalWindows,
      totalComponents,
      itemCount: items.length,
      sheets,
    };
  }
}
