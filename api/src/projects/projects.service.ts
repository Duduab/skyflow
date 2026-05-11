import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProductComponentKind,
  ProjectDocumentKind,
  ProjectFlowStatus,
  SkyflowRole,
} from '@prisma/client';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PlanningUploadService } from '../planning/planning-upload.service';
import { isProjectProductionComplete } from '../common/project-station-completion.util';
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
    const assigneeId =
      dto?.assigneeUserId && String(dto.assigneeUserId).trim().length
        ? String(dto.assigneeUserId).trim()
        : null;

    if (assigneeId) {
      const u = await this.prisma.user.findUnique({
        where: { id: assigneeId },
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

    const sawKinds: ProductComponentKind[] = [
      ProductComponentKind.BEAM,
      ProductComponentKind.FRAME,
    ];

    await this.prisma.$transaction(async (tx) => {
      await tx.sawStationWorkLine.deleteMany({ where: { projectId } });
      let sort = 0;
      for (const item of order.productItems) {
        for (const comp of item.components) {
          if (!sawKinds.includes(comp.kind)) continue;
          // quantity = סה״כ חיתוכים לשורה (כבר מוכפל בפרסור לפי עמודת QUANTITY ב־Excel)
          await tx.sawStationWorkLine.create({
            data: {
              projectId,
              componentKind: comp.kind,
              description: `[${item.label}] ${comp.description}`,
              quantity: comp.quantity,
              sortOrder: sort++,
            },
          });
        }
      }

      await tx.projectOrder.update({
        where: { id: projectId },
        data: {
          flowStatus: ProjectFlowStatus.IN_PRODUCTION,
          status: OrderStatus.IN_PROGRESS,
          planningAssigneeUserId: assigneeId,
        },
      });
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
