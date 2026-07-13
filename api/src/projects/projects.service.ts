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
  ProjectAngleSourcing,
  ProjectDocumentKind,
  ProjectFlowStatus,
  ProjectLineMaterial,
  ProjectMachiningRoute,
  SkyflowRole,
} from '@prisma/client';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PlanningUploadService } from '../planning/planning-upload.service';
import {
  normalizeSheetTabName,
  pickPlanningImagesForColumn,
} from '../planning/planning-image-match.util';
import {
  clearPlanningImportDir,
  loadPlanningImportManifest,
  planningImportStorageDir,
  type PlanningSheetImagesManifest,
} from '../planning/planning-workbook-media';
import { persistAssemblyPlanningMedia } from '../planning/planning-assembly-media';
import { isProjectProductionComplete } from '../common/project-station-completion.util';
import { planningCutLengthMmFromSpec } from '../common/planning-cut-length.util';
import type { ApprovePlanningDto } from './dto/approve-planning.dto.js';
import type { UpdatePlanningDraftDto } from './dto/update-planning-draft.dto.js';
import type { UploadProjectDocumentDto } from './dto/upload-project-document.dto.js';
import type { SendProjectDocumentEmailDto } from './dto/send-project-document-email.dto.js';
import { MailService } from '../mail/mail.service.js';
import { planningDraftWizardMeta } from '../common/planning-draft-progress.util.js';
import { DailyTargetPlanningService } from '../users/daily-target-planning.service.js';
import { ElevationService } from '../elevation/elevation.service.js';
import { WindowPlanningService } from '../planning/window-planning.service.js';
import { readFileSync } from 'fs';

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

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planningUpload: PlanningUploadService,
    private readonly mail: MailService,
    private readonly dailyTargetPlanning: DailyTargetPlanningService,
    private readonly elevation: ElevationService,
    private readonly windowPlanning: WindowPlanningService,
  ) {}

  async createPlanningDraft(
    name: string,
    requirements: string | undefined,
    createdByUserId: string | null | undefined,
    lineMaterial: ProjectLineMaterial,
    machiningRoute: ProjectMachiningRoute,
    angleSourcing?: ProjectAngleSourcing,
  ) {
    const details = requirements?.trim() ?? '';
    const creatorId =
      createdByUserId && String(createdByUserId).trim().length
        ? String(createdByUserId).trim()
        : null;
    return this.prisma.projectOrder.create({
      data: {
        name: name.trim(),
        totalItems: 0,
        requirements: details,
        status: OrderStatus.PENDING,
        flowStatus: ProjectFlowStatus.PENDING_PLANNING,
        originalLength: new Prisma.Decimal(0),
        createdByUserId: creatorId,
        lineMaterial,
        machiningRoute,
        angleSourcing: angleSourcing ?? ProjectAngleSourcing.INTERNAL_LASER,
      },
    });
  }

  /**
   * New 4-PDF flow: store one of the planning PDFs as a ProjectDocument and
   * parse it into the relational model (window types / quantities / angles /
   * elevation cells). Allowed while the project is a planning draft.
   */
  async ingestPlanningPdf(
    projectId: string,
    file: Express.Multer.File,
    kind: ProjectDocumentKind,
    title?: string,
    targetQty?: number,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true, flowStatus: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (project.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning PDFs can only be uploaded while the project is pending planning approval',
      );
    }

    let buffer: Buffer | null = null;
    try {
      buffer = readFileSync(join(ensureProjectDocsUploadDir(), file.filename));
    } catch {
      buffer = null;
    }

    const titleBase =
      (title && title.trim()) ||
      file.originalname.replace(/\.pdf$/i, '').trim() ||
      'PDF';
    const docTitle = titleBase.slice(0, 500);
    const agg = await this.prisma.projectDocument.aggregate({
      where: { projectId, kind },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const pdfPath = `/assets/project-docs/uploads/${file.filename}`;
    const doc = await this.prisma.projectDocument.create({
      data: { projectId, kind, title: docTitle, pdfPath, sortOrder },
    });

    const result: Record<string, unknown> = { kind };

    // נספח פרטי חיבור וזוויות (מסגריה) — אין פענוח, פשוט שורה אחת לכל קובץ.
    if (kind === ProjectDocumentKind.CONNECTION_DETAILS_PDF) {
      const detailAgg = await this.prisma.steelworkDetail.aggregate({
        where: { projectId },
        _max: { sortOrder: true },
      });
      await this.prisma.steelworkDetail.create({
        data: {
          projectId,
          title: docTitle.slice(0, 300),
          targetQty: Math.max(0, Math.floor(targetQty ?? 0)),
          instructionDocId: doc.id,
          sortOrder: (detailAgg._max.sortOrder ?? -1) + 1,
        },
      });
      result.steelworkDetail = true;
    }
    if (buffer) {
      try {
        if (kind === ProjectDocumentKind.ELEVATION_MAP) {
          await this.elevation.analyzeDocument({
            projectId,
            documentId: doc.id,
            title: docTitle,
            fileBuffer: buffer,
          });
          result.elevation = await this.windowPlanning.linkElevationCellsToWindowTypes(
            projectId,
          );
        } else if (kind === ProjectDocumentKind.WINDOW_INSTRUCTION_PDF) {
          Object.assign(
            result,
            await this.windowPlanning.persistWindowInstructions(
              projectId,
              doc.id,
              buffer,
            ),
          );
        } else if (kind === ProjectDocumentKind.QUANTITIES_PDF) {
          Object.assign(
            result,
            await this.windowPlanning.persistQuantities(projectId, buffer),
          );
        } else if (kind === ProjectDocumentKind.ANGLE_INSTRUCTION_PDF) {
          Object.assign(
            result,
            await this.windowPlanning.persistAngles(projectId, doc.id, buffer),
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Planning PDF parse failed', err);
        throw new BadRequestException(
          'Could not parse the uploaded PDF — check the file and try again',
        );
      }
    }

    const preview = await this.windowPlanning.buildPlanningPreview(projectId);
    return {
      ok: true as const,
      document: {
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        pdfUrl: pdfPath,
        createdAt: doc.createdAt.toISOString(),
      },
      parse: result,
      preview,
    };
  }

  /**
   * Upload a PDF that belongs to a single window type (from the quantities
   * breakdown row): window instructions (parsed for that unit), a connection
   * details appendix (attached for viewing), or ANG instructions (mapped by
   * code to the shared project angles).
   */
  async ingestWindowTypePdf(
    projectId: string,
    windowTypeId: string,
    file: Express.Multer.File,
    kind: ProjectDocumentKind,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true, flowStatus: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (project.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning PDFs can only be uploaded while the project is pending planning approval',
      );
    }
    const allowed: ProjectDocumentKind[] = [
      ProjectDocumentKind.WINDOW_INSTRUCTION_PDF,
      ProjectDocumentKind.CONNECTION_DETAILS_PDF,
      ProjectDocumentKind.ANGLE_INSTRUCTION_PDF,
    ];
    if (!allowed.includes(kind)) {
      throw new BadRequestException('Unsupported document kind for a window type');
    }

    let buffer: Buffer | null = null;
    try {
      buffer = readFileSync(join(ensureProjectDocsUploadDir(), file.filename));
    } catch {
      buffer = null;
    }

    const docTitle = (file.originalname.replace(/\.pdf$/i, '').trim() || 'PDF').slice(
      0,
      500,
    );
    const agg = await this.prisma.projectDocument.aggregate({
      where: { projectId, kind },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const pdfPath = `/assets/project-docs/uploads/${file.filename}`;
    const doc = await this.prisma.projectDocument.create({
      data: { projectId, kind, title: docTitle, pdfPath, sortOrder },
    });

    const result: Record<string, unknown> = { kind, windowTypeId };
    try {
      if (kind === ProjectDocumentKind.CONNECTION_DETAILS_PDF) {
        await this.windowPlanning.attachConnectionDetails(
          projectId,
          windowTypeId,
          doc.id,
        );
        result.connectionAttached = true;
      } else if (buffer && kind === ProjectDocumentKind.WINDOW_INSTRUCTION_PDF) {
        Object.assign(
          result,
          await this.windowPlanning.persistWindowInstructionsForType(
            projectId,
            windowTypeId,
            doc.id,
            buffer,
          ),
        );
      } else if (buffer && kind === ProjectDocumentKind.ANGLE_INSTRUCTION_PDF) {
        Object.assign(
          result,
          await this.windowPlanning.persistAngles(projectId, doc.id, buffer),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Window-type PDF parse failed', err);
      throw new BadRequestException(
        'Could not parse the uploaded PDF — check the file and try again',
      );
    }

    const preview = await this.windowPlanning.buildPlanningPreview(projectId);
    return {
      ok: true as const,
      document: {
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        pdfUrl: pdfPath,
        createdAt: doc.createdAt.toISOString(),
      },
      parse: result,
      preview,
    };
  }

  /**
   * Upload the elevation-map PDF for a facade GROUP. A group is the label
   * prefix before '-' (S-w/S-e → S, N5-w/N5-e → N5, W2 → W2); one PDF covers
   * all sub-facades in the group. Analyzed into cells tied to the group's map;
   * the document is linked to every facade in the group. Re-uploading replaces
   * the group's previous map + document.
   */
  async ingestFacadeGroupElevation(
    projectId: string,
    groupKey: string,
    file: Express.Multer.File,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true, flowStatus: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (project.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Elevation maps can only be uploaded while the project is pending planning approval',
      );
    }
    const facades = await this.prisma.facade.findMany({
      where: { projectId, groupKey },
      select: { id: true, elevationDocId: true },
    });
    if (!facades.length) {
      throw new NotFoundException('Facade group not found for this project');
    }

    let buffer: Buffer | null = null;
    try {
      buffer = readFileSync(join(ensureProjectDocsUploadDir(), file.filename));
    } catch {
      buffer = null;
    }

    // replace a previously uploaded map/document for this group
    const oldDocIds = [
      ...new Set(
        facades
          .map((f) => f.elevationDocId)
          .filter((v): v is string => !!v),
      ),
    ];
    if (oldDocIds.length) {
      for (const oldDocId of oldDocIds) {
        await this.elevation.deleteForDocument(oldDocId);
      }
      await this.prisma.facade.updateMany({
        where: { projectId, groupKey },
        data: { elevationDocId: null },
      });
      await this.prisma.projectDocument
        .deleteMany({ where: { id: { in: oldDocIds } } })
        .catch(() => undefined);
    }

    const docTitle = (
      file.originalname.replace(/\.pdf$/i, '').trim() ||
      `${groupKey} — elevation`
    ).slice(0, 500);
    const agg = await this.prisma.projectDocument.aggregate({
      where: { projectId, kind: ProjectDocumentKind.ELEVATION_MAP },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const pdfPath = `/assets/project-docs/uploads/${file.filename}`;
    const doc = await this.prisma.projectDocument.create({
      data: {
        projectId,
        kind: ProjectDocumentKind.ELEVATION_MAP,
        title: docTitle,
        pdfPath,
        sortOrder,
      },
    });
    await this.prisma.facade.updateMany({
      where: { projectId, groupKey },
      data: { elevationDocId: doc.id },
    });

    if (buffer) {
      await this.elevation.analyzeDocument({
        projectId,
        documentId: doc.id,
        title: docTitle,
        fileBuffer: buffer,
        facadeGroup: groupKey,
      });
      await this.windowPlanning.linkElevationCellsToWindowTypes(projectId);
    }

    const preview = await this.windowPlanning.buildPlanningPreview(projectId);
    return {
      ok: true as const,
      document: {
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        pdfUrl: pdfPath,
        createdAt: doc.createdAt.toISOString(),
      },
      facadeGroup: groupKey,
      preview,
    };
  }

  getPlanningPdfPreview(projectId: string) {
    return this.windowPlanning.buildPlanningPreview(projectId);
  }

  /** טיוטות בלבד — פרויקטים שלא אושרו עדיין (ללא popup «נוצר בהצלחה»). אחרי approve → IN_PRODUCTION ולא ברשימה זו. */
  listPlanningDrafts() {
    return this.prisma.projectOrder
      .findMany({
        where: { flowStatus: ProjectFlowStatus.PENDING_PLANNING },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          flowStatus: true,
          updatedAt: true,
          createdAt: true,
          requirements: true,
          lineMaterial: true,
          machiningRoute: true,
          angleSourcing: true,
          _count: { select: { productItems: true, windowTypes: true } },
        },
      })
      .then((rows) =>
        rows.map((r) => {
          const itemCount = Math.max(
            r._count.productItems,
            r._count.windowTypes,
          );
          const { wizardStep, progressPct } = planningDraftWizardMeta(itemCount);
          return {
            id: r.id,
            name: r.name,
            flowStatus: r.flowStatus,
            updatedAt: r.updatedAt,
            createdAt: r.createdAt,
            requirements: r.requirements ?? '',
            lineMaterial: r.lineMaterial,
            machiningRoute: r.machiningRoute,
            angleSourcing: r.angleSourcing,
            itemCount,
            windowTypeCount: r._count.windowTypes,
            wizardStep,
            progressPct,
          };
        }),
      );
  }

  async updatePlanningDraft(projectId: string, dto: UpdatePlanningDraftDto) {
    const order = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
    });
    if (!order) throw new NotFoundException(`Project ${projectId} not found`);
    if (order.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException('Only planning drafts can be updated');
    }
    const data: Prisma.ProjectOrderUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.requirements !== undefined) {
      data.requirements = dto.requirements.trim();
    }
    if (dto.lineMaterial !== undefined) {
      data.lineMaterial = dto.lineMaterial;
    }
    if (dto.machiningRoute !== undefined) {
      data.machiningRoute = dto.machiningRoute;
    }
    if (dto.angleSourcing !== undefined) {
      data.angleSourcing = dto.angleSourcing;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }
    const updated = await this.prisma.projectOrder.update({
      where: { id: projectId },
      data,
    });
    const itemCount = await this.prisma.productItem.count({
      where: { projectId },
    });
    const { wizardStep, progressPct } = planningDraftWizardMeta(itemCount);
    return {
      id: projectId,
      name: updated.name,
      flowStatus: updated.flowStatus,
      updatedAt: updated.updatedAt,
      createdAt: updated.createdAt,
      requirements: updated.requirements ?? '',
      lineMaterial: updated.lineMaterial,
      machiningRoute: updated.machiningRoute,
      angleSourcing: updated.angleSourcing,
      itemCount,
      wizardStep,
      progressPct,
    };
  }

  async deletePlanningDraft(projectId: string) {
    const order = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
    });
    if (!order) throw new NotFoundException(`Project ${projectId} not found`);
    if (order.flowStatus !== ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException('Only planning drafts can be deleted');
    }
    clearPlanningImportDir(projectId);
    await this.prisma.projectOrder.delete({ where: { id: projectId } });
    return { ok: true };
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

    // New 4-PDF flow: production data comes from window types + quantities.
    const windowAgg = await this.prisma.windowType.aggregate({
      where: { projectId },
      _sum: { totalQty: true },
      _count: true,
    });
    if (windowAgg._count > 0) {
      return this.approvePlanningFromWindowTypes({
        projectId,
        projectName: order.name,
        lineMaterial: order.lineMaterial,
        machiningRoute: order.machiningRoute,
        totalUnits: windowAgg._sum.totalQty ?? 0,
        teamMode,
        workerIdsOrdered,
        planningSawsManagerUserId,
        planningAssigneeUserId,
      });
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
      planningCutLengthMm: number | null;
      sawsProfileCode: string | null;
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
          planningCutLengthMm: planningCutLengthMmFromSpec(comp.spec),
          sawsProfileCode: comp.sawsProfileCode ?? null,
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
            planningCutLengthMm: row.planningCutLengthMm,
            sawsProfileCode: row.sawsProfileCode,
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

    const syncWorkers = teamMode
      ? workerIdsOrdered
      : planningAssigneeUserId
        ? [planningAssigneeUserId]
        : [];
    await this.dailyTargetPlanning.syncFromPlanningApproval({
      projectId,
      projectName: order.name,
      lineMaterial: order.lineMaterial,
      machiningRoute: order.machiningRoute,
      stationId: 1,
      workerUserIds: syncWorkers,
      managerUserId: teamMode ? planningSawsManagerUserId : null,
      sawLines: preparedSawLines.map((row) => ({
        description: row.description,
        quantity: row.quantity,
        sawsProfileCode: row.sawsProfileCode,
        planningCutLengthMm: row.planningCutLengthMm,
        instructionKind: row.instructionKind,
        sortOrder: row.sortOrder,
      })),
    });

    const itemsAfter = await this.prisma.productItem.findMany({
      where: { projectId },
      include: { components: true },
      orderBy: { sortOrder: 'asc' },
    });
    persistAssemblyPlanningMedia(projectId, itemsAfter, manifest);

    clearPlanningImportDir(projectId);

    return { ok: true, flowStatus: ProjectFlowStatus.IN_PRODUCTION };
  }

  /** Approve a project built from the 4-PDF flow (window types drive totals). */
  private async approvePlanningFromWindowTypes(params: {
    projectId: string;
    projectName: string;
    lineMaterial: ProjectLineMaterial;
    machiningRoute: ProjectMachiningRoute;
    totalUnits: number;
    teamMode: boolean;
    workerIdsOrdered: string[];
    planningSawsManagerUserId: string | null;
    planningAssigneeUserId: string | null;
  }) {
    const {
      projectId,
      projectName,
      lineMaterial,
      machiningRoute,
      totalUnits,
      teamMode,
      workerIdsOrdered,
      planningSawsManagerUserId,
      planningAssigneeUserId,
    } = params;

    const totalItems = Math.max(1, totalUnits);

    await this.prisma.$transaction(async (tx) => {
      // No Excel-derived saw lines in the PDF flow.
      await tx.sawStationWorkLine.deleteMany({ where: { projectId } });
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
          totalItems,
          flowStatus: ProjectFlowStatus.IN_PRODUCTION,
          status: OrderStatus.IN_PROGRESS,
          planningAssigneeUserId,
          planningSawsManagerUserId,
        },
      });
    });

    const syncWorkers = teamMode
      ? workerIdsOrdered
      : planningAssigneeUserId
        ? [planningAssigneeUserId]
        : [];
    await this.dailyTargetPlanning.syncFromPlanningApproval({
      projectId,
      projectName,
      lineMaterial,
      machiningRoute,
      stationId: 1,
      workerUserIds: syncWorkers,
      managerUserId: teamMode ? planningSawsManagerUserId : null,
      sawLines: [],
    });

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

    const laser = await this.laserCompletionRequirement(projectId, order);

    if (
      !isProjectProductionComplete(
        order,
        qty,
        latest7?.extraPayload ?? null,
        laser,
      )
    ) {
      throw new BadRequestException(
        'All stations must be at 100% before completing',
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
    const laser = await this.laserCompletionRequirement(projectId, order);
    return isProjectProductionComplete(
      order,
      qty,
      latest7?.extraPayload ?? null,
      laser,
    );
  }

  /** Laser station is required for completion only for internal-laser projects with ANG. */
  private async laserCompletionRequirement(
    projectId: string,
    order: { angleSourcing: ProjectAngleSourcing },
  ): Promise<{ required: boolean; target: number }> {
    if (order.angleSourcing !== ProjectAngleSourcing.INTERNAL_LASER) {
      return { required: false, target: 0 };
    }
    const agg = await this.prisma.angle.aggregate({
      where: { projectId },
      _sum: { qty: true },
      _count: true,
    });
    const target = agg._sum.qty ?? 0;
    return { required: agg._count > 0 && target > 0, target };
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

    // Read the uploaded PDF once for content-based detection + analysis.
    let buffer: Buffer | null = null;
    try {
      buffer = readFileSync(join(ensureProjectDocsUploadDir(), file.filename));
    } catch {
      buffer = null;
    }

    // Auto-detect elevation maps by PDF content (gray spandrel + cyan unit
    // cells) — independent of file name or the chosen document kind.
    let kind = dto.kind;
    if (
      kind !== ProjectDocumentKind.ELEVATION_MAP &&
      buffer &&
      (await this.elevation.looksLikeElevation(buffer))
    ) {
      kind = ProjectDocumentKind.ELEVATION_MAP;
    }

    const agg = await this.prisma.projectDocument.aggregate({
      where: { projectId, kind },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const pdfPath = `/assets/project-docs/uploads/${file.filename}`;

    const doc = await this.prisma.projectDocument.create({
      data: {
        projectId,
        kind,
        title,
        reference,
        pdfPath,
        sortOrder,
      },
    });

    // Elevation install map: analyze the PDF into clickable cells.
    if (kind === ProjectDocumentKind.ELEVATION_MAP && buffer) {
      try {
        await this.elevation.analyzeDocument({
          projectId,
          documentId: doc.id,
          title,
          fileBuffer: buffer,
        });
      } catch (err) {
        // analysis failures are recorded on the map; never block the upload
        // eslint-disable-next-line no-console
        console.error('Elevation analysis trigger failed', err);
      }
    }

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

  async sendProjectDocumentEmail(
    documentId: string,
    dto: SendProjectDocumentEmailDto,
  ) {
    const doc = await this.prisma.projectDocument.findUnique({
      where: { id: documentId },
      include: { project: { select: { name: true } } },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    const absolutePdfPath = join(
      process.cwd(),
      '..',
      'web',
      'public',
      doc.pdfPath.replace(/^\//, ''),
    );
    if (!existsSync(absolutePdfPath)) {
      throw new NotFoundException('PDF file not found on disk');
    }

    const recipients = [
      ...new Set(dto.recipients.map((e) => e.trim().toLowerCase())),
    ];
    const origin = dto.origin?.trim().replace(/\/$/, '') ?? '';
    const link = origin ? `${origin}${doc.pdfPath}` : doc.pdfPath;
    const kindLabel =
      doc.kind === 'WORK_ORDER' ? 'Work order' : 'Purchase order';
    const message = dto.message?.trim() ?? '';
    const text = [
      message,
      message ? '' : undefined,
      `Project: ${doc.project.name}`,
      `Type: ${kindLabel}`,
      doc.reference ? `Reference: ${doc.reference}` : undefined,
      `File: ${link}`,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');

    const subject = doc.title;
    const attachmentName = subject.toLowerCase().endsWith('.pdf')
      ? subject
      : `${subject}.pdf`;

    if (this.mail.isConfigured()) {
      await this.mail.sendDocumentPdf({
        to: recipients,
        subject,
        text,
        absolutePdfPath,
        attachmentName,
      });
      return { sent: true as const, mode: 'smtp' as const };
    }

    return {
      sent: false as const,
      mode: 'mailto' as const,
      mailto: this.buildDocumentMailto(recipients, subject, text),
    };
  }

  private buildDocumentMailto(
    recipients: string[],
    subject: string,
    body: string,
  ): string {
    const to = recipients.join(',');
    const params = new URLSearchParams();
    params.set('subject', subject);
    params.set('body', body);
    return `mailto:${to}?${params.toString()}`;
  }
}
