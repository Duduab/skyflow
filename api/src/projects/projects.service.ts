import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProductComponentKind,
  ProjectFlowStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanningUploadService } from '../planning/planning-upload.service';
import { isProjectProductionComplete } from '../common/project-station-completion.util';

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

  async approvePlanning(projectId: string) {
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
}
