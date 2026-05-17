import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProductComponentKind,
  ProductType,
  ProjectDocumentKind,
  ProjectFlowStatus,
  SkyflowRole,
} from '@prisma/client';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PlanningUploadService } from '../planning/planning-upload.service';
import {
  clearPlanningImportDir,
  loadPlanningImportManifest,
  planningImportStorageDir,
  type PlanningSheetImagesManifest,
} from '../planning/planning-workbook-media';
import { isProjectProductionComplete } from '../common/project-station-completion.util';
import { planningCutLengthCmFromSpec } from '../common/planning-cut-length.util';
import type { ApprovePlanningDto } from './dto/approve-planning.dto.js';
import type { UploadProjectDocumentDto } from './dto/upload-project-document.dto.js';

/** PDFs attached to projects — served as static files from the web app. */
export function ensureProjectDocsUploadDir(): string {
  const dir = join(
    process.cwd(),
    '..',
    'web',
    'public',
    'assets',
    'project-docs',
    'uploads',
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** תמונות מסורים לאחר אישור — מוגשות מ־`web/public/planning-saws/{projectId}/` */
export function ensureSawPlanningCaptureDir(projectId: string): string {
  return join(
    process.cwd(),
    '..',
    'web',
    'public',
    'planning-saws',
    projectId,
  );
}

function sheetNameFromProductLabelForSaws(label: string): string {
  const m = label.match(/^\[([^\]]+)\]\s*/);
  return m ? m[1].trim() : '—';
}

function normalizeSheetTabNameForSaws(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function imageRowDistanceToBlock(
  anchorRow: number,
  blockStart: number,
  blockEnd: number,
): number {
  if (anchorRow < blockStart) return blockStart - anchorRow;
  if (anchorRow > blockEnd) return anchorRow - blockEnd;
  return 0;
}

function pickPlanningImagesForColumn(
  manifest: PlanningSheetImagesManifest[],
  sheetTitle: string,
  col0: number,
  rowStart: number,
  rowEnd: number,
  maxSkew: number,
): { file: string }[] {
  const key = normalizeSheetTabNameForSaws(sheetTitle);
  const sheet = manifest.find(
    (m) => normalizeSheetTabNameForSaws(m.sheetName) === key,
  );
  if (!sheet) return [];
  const hits: (typeof sheet.images)[number][] = [];
  for (const im of sheet.images) {
    if (im.anchorCol !== col0) continue;
    const d = imageRowDistanceToBlock(im.anchorRow, rowStart, rowEnd);
    if (d <= maxSkew) hits.push(im);
  }
  hits.sort(
    (a, b) => a.anchorRow - b.anchorRow || a.anchorCol - b.anchorCol,
  );
  return hits.map(({ file }) => ({ file }));
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planningUpload: PlanningUploadService,
  ) {}

  async createPlanningDraft(name: string) {
    return this.prisma.projectOrder.create({
      data: {
        name: name.trim(),
        totalItems: 0,
        requirements: '',
        status: OrderStatus.PENDING,
        flowStatus: ProjectFlowStatus.PENDING_PLANNING,
        originalLength: new Prisma.Decimal(0),
      },
    });
  }

  listPlanningDrafts() {
    return this.prisma.projectOrder.findMany({
      where: { flowStatus: ProjectFlowStatus.PENDING_PLANNING },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        flowStatus: true,
        updatedAt: true,
      },
    });
  }

  async ingestPlanningFile(projectId: string, buffer: Buffer) {
    return this.planningUpload.replaceParsedData(projectId, buffer);
  }

  getPlanningPreview(projectId: string) {
    return this.planningUpload.buildPreview(projectId);
  }

  async approvePlanning(projectId: string, dto?: ApprovePlanningDto) {
    const teamMode = dto != null && Array.isArray(dto.sawsWorkerUserIds);

    let planningSawsManagerUserId: string | null = null;
    let workerIdsOrdered: string[] = [];
    let planningAssigneeUserId: string | null = null;

    if (teamMode) {
      const raw = dto!.sawsWorkerUserIds ?? [];
      workerIdsOrdered = [
        ...new Set(
          raw
            .map((x) => String(x).trim())
            .filter((x) => x.length > 0),
        ),
      ];
      const mgrRaw = dto!.planningSawsManagerUserId;
      planningSawsManagerUserId =
        mgrRaw && String(mgrRaw).trim().length
          ? String(mgrRaw).trim()
          : null;

      if (planningSawsManagerUserId) {
        const mgr = await this.prisma.user.findUnique({
          where: { id: planningSawsManagerUserId },
          select: { id: true, role: true, managedStationId: true },
        });
        if (!mgr) {
          throw new BadRequestException('Saws manager user not found');
        }
        if (
          mgr.role !== SkyflowRole.STATION_MANAGER ||
          mgr.managedStationId !== 1
        ) {
          throw new BadRequestException(
            'Saws manager must be a station manager for station 1',
          );
        }
      }

      if (workerIdsOrdered.length) {
        const workers = await this.prisma.user.findMany({
          where: { id: { in: workerIdsOrdered } },
          select: { id: true, role: true },
        });
        if (workers.length !== workerIdsOrdered.length) {
          throw new BadRequestException('One or more worker users not found');
        }
        for (const w of workers) {
          if (w.role !== SkyflowRole.WORKER) {
            throw new BadRequestException(
              'Saws workers must have the worker role',
            );
          }
        }
      }

      planningAssigneeUserId = workerIdsOrdered[0] ?? null;
    } else {
      planningSawsManagerUserId = null;
      workerIdsOrdered = [];
      planningAssigneeUserId =
        dto?.assigneeUserId && String(dto.assigneeUserId).trim().length
          ? String(dto.assigneeUserId).trim()
          : null;

      if (planningAssigneeUserId) {
        const u = await this.prisma.user.findUnique({
          where: { id: planningAssigneeUserId },
          select: { id: true, role: true, managedStationId: true },
        });
        if (!u) throw new BadRequestException('Assignee user not found');
        const allowed =
          u.role === SkyflowRole.WORKER ||
          (u.role === SkyflowRole.STATION_MANAGER &&
            u.managedStationId === 1);
        if (!allowed) {
          throw new BadRequestException(
            'Assignee must be a worker or station-1 (saws) manager',
          );
        }
      }
    }

    const order = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      include: {
        productItems: { include: { components: true } },
      },
    });
    if (!order) throw new NotFoundException(`Project ${projectId} not found`);
    if (order.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException('Project is not awaiting planning approval');
    }
    if (!order.productItems.length) {
      throw new BadRequestException('Upload and parse a planning file first');
    }

    const manifest = loadPlanningImportManifest(projectId);
    const importDir = planningImportStorageDir(projectId);
    const captureRoot = ensureSawPlanningCaptureDir(projectId);
    try {
      rmSync(captureRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    mkdirSync(captureRoot, { recursive: true });

    const sawKinds: ProductComponentKind[] = [
      ProductComponentKind.BEAM,
      ProductComponentKind.FRAME,
    ];

    const preparedSawLines: {
      componentKind: ProductComponentKind;
      description: string;
      quantity: number;
      sortOrder: number;
      imagePaths: string[];
      instructionKind: string;
      planningCutLengthCm: number | null;
    }[] = [];

    let sawSort = 0;
    for (const item of order.productItems) {
      if (
        item.instructionKind === 'WINDOW_INSTRUCTION' ||
        item.productType === ProductType.WINDOW
      ) {
        continue;
      }
      const sheetTitle = sheetNameFromProductLabelForSaws(item.label);
      const rowS = item.planningBlockStartRow0 ?? 0;
      const rowE = item.planningBlockEndRow0 ?? rowS;
      for (const comp of item.components) {
        if (!comp.sawsProfileCode) continue;
        if (!sawKinds.includes(comp.kind)) continue;
        if (comp.planningSourceCol0 == null) continue;

        const imgs = pickPlanningImagesForColumn(
          manifest,
          sheetTitle,
          comp.planningSourceCol0,
          rowS,
          rowE,
          22,
        );
        const imagePaths: string[] = [];
        let pic = 0;
        for (const { file } of imgs) {
          const src = join(importDir, file);
          if (!existsSync(src)) continue;
          const ext = extname(file) || '.bin';
          const destName = `sl-${sawSort}-${pic++}${ext}`;
          copyFileSync(src, join(captureRoot, destName));
          imagePaths.push(`/planning-saws/${projectId}/${destName}`);
        }

        preparedSawLines.push({
          componentKind: comp.kind,
          description: `[${item.label}] ${comp.description}`,
          quantity: comp.quantity,
          sortOrder: sawSort++,
          imagePaths,
          instructionKind: item.instructionKind,
          planningCutLengthCm: planningCutLengthCmFromSpec(comp.spec),
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.sawStationWorkLine.deleteMany({ where: { projectId } });
      for (const row of preparedSawLines) {
        await tx.sawStationWorkLine.create({
          data: {
            projectId,
            componentKind: row.componentKind,
            description: row.description,
            quantity: row.quantity,
            sortOrder: row.sortOrder,
            imagePaths: row.imagePaths,
            instructionKind: row.instructionKind,
            planningCutLengthCm: row.planningCutLengthCm,
          },
        });
      }

      await tx.projectPlanningSawsWorker.deleteMany({ where: { projectId } });

      if (teamMode && workerIdsOrdered.length) {
        let sort = 0;
        for (const userId of workerIdsOrdered) {
          await tx.projectPlanningSawsWorker.create({
            data: { projectId, userId, sortOrder: sort++ },
          });
        }
      }

      await tx.projectOrder.update({
        where: { id: projectId },
        data: {
          flowStatus: ProjectFlowStatus.IN_PRODUCTION,
          status: OrderStatus.IN_PROGRESS,
          planningAssigneeUserId,
          planningSawsManagerUserId,
        },
      });
    });

    clearPlanningImportDir(projectId);

    return { ok: true, flowStatus: ProjectFlowStatus.IN_PRODUCTION };
  }

  async completeProject(projectId: string) {
    const order = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
    });
    if (!order) throw new NotFoundException(`Project ${projectId} not found`);
    if (order.flowStatus === ProjectFlowStatus.COMPLETED) {
      throw new BadRequestException('Project is already completed');
    }
    if (order.flowStatus !== ProjectFlowStatus.IN_PRODUCTION) {
      throw new BadRequestException(
        'Project must be in production before completion',
      );
    }

    const grouped = await this.prisma.stationLog.groupBy({
      by: ['stationId'],
      where: { projectId },
      _sum: { processedQty: true },
    });
    const qty = (sid: number) =>
      grouped.find((g) => g.stationId === sid)?._sum.processedQty ?? 0;

    const latest7 = await this.prisma.stationLog.findFirst({
      where: { projectId, stationId: 7 },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !isProjectProductionComplete(
        order,
        qty,
        latest7?.extraPayload ?? null,
      )
    ) {
      throw new BadRequestException(
        'All stations (1–7, including on-site assembly) must be at 100% before completing',
      );
    }

    await this.prisma.projectOrder.update({
      where: { id: projectId },
      data: {
        flowStatus: ProjectFlowStatus.COMPLETED,
        status: OrderStatus.COMPLETED,
      },
    });

    return { ok: true, flowStatus: ProjectFlowStatus.COMPLETED };
  }

  async canComplete(projectId: string): Promise<boolean> {
    const order = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
    });
    if (!order || order.flowStatus !== ProjectFlowStatus.IN_PRODUCTION) {
      return false;
    }
    const grouped = await this.prisma.stationLog.groupBy({
      by: ['stationId'],
      where: { projectId },
      _sum: { processedQty: true },
    });
    const qty = (sid: number) =>
      grouped.find((g) => g.stationId === sid)?._sum.processedQty ?? 0;
    const latest7 = await this.prisma.stationLog.findFirst({
      where: { projectId, stationId: 7 },
      orderBy: { createdAt: 'desc' },
    });
    return isProjectProductionComplete(
      order,
      qty,
      latest7?.extraPayload ?? null,
    );
  }

  async uploadProjectDocument(
    projectId: string,
    file: Express.Multer.File,
    dto: UploadProjectDocumentDto,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }

    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const titleBase =
      (dto.title && dto.title.trim()) ||
      file.originalname.replace(/\.pdf$/i, '').trim() ||
      'PDF';
    const title = titleBase.slice(0, 500);
    const reference =
      dto.reference && dto.reference.trim()
        ? dto.reference.trim().slice(0, 120)
        : null;

    const agg = await this.prisma.projectDocument.aggregate({
      where: { projectId, kind: dto.kind },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const pdfPath = `/assets/project-docs/uploads/${file.filename}`;

    const doc = await this.prisma.projectDocument.create({
      data: {
        projectId,
        kind: dto.kind,
        title,
        reference,
        pdfPath,
        sortOrder,
      },
    });

    return {
      ok: true as const,
      document: {
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        reference: doc.reference,
        pdfUrl: pdfPath,
        createdAt: doc.createdAt.toISOString(),
      },
    };
  }
}
