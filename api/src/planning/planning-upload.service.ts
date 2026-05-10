import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectFlowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parsePlanningWorkbook } from './planning-excel.parser';

const PREVIEW_MAX_COMPONENT_LINES = 18;

function sheetNameFromProductLabel(label: string): string {
  const m = label.match(/^\[([^\]]+)\]\s*/);
  return m ? m[1].trim() : '—';
}

function displayLabelWithoutSheetPrefix(label: string): string {
  return label.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function componentToPreviewLine(c: {
  kind: string;
  description: string;
  spec: string | null;
}): string {
  const spec = c.spec?.trim();
  return spec ? `${c.kind}: ${c.description} — ${spec}` : `${c.kind}: ${c.description}`;
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
        }[];
      }
    >();

    for (const it of items) {
      const sheet = sheetNameFromProductLabel(it.label);
      if (!rowsBySheet.has(sheet)) {
        rowsBySheet.set(sheet, { unitCount: 0, windowCount: 0, rows: [] });
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
      });
    }

    const sheets = sheetOrder.map((sheetName) => {
      const b = rowsBySheet.get(sheetName)!;
      return {
        sheetName,
        unitCount: b.unitCount,
        windowCount: b.windowCount,
        itemCount: b.rows.length,
        rows: b.rows,
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
