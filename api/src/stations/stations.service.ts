import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Prisma, ProjectFlowStatus, SkyflowRole } from '@prisma/client';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  assembledFromLogPayload,
  computeSiteAssemblyPercent,
} from '../common/site-assembly.util';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CreateStationLogDto } from './dto/create-station-log.dto.js';
import { CreateScrapReportDto } from './dto/create-scrap-report.dto.js';

const MIN_STATION = 1;
const MAX_STATION = 7;

/** Writable public folder for delivery-note PDFs (served by Angular dev server / static hosting). */
export function siteDeliveryUploadDir(): string {
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'site-delivery');
}

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  private assertStation(stationId: number): void {
    if (stationId < MIN_STATION || stationId > MAX_STATION) {
      throw new BadRequestException(
        `stationId must be between ${MIN_STATION} and ${MAX_STATION}`,
      );
    }
  }

  /** שם ותמונה להצגה במסוף עובד — לעמדה 1: שיבוץ מתכנון אם קיים, אחרת מנהל עמדה מהמערכת */
  private async resolveStationManagerDisplay(
    stationId: number,
    planningAssigneeUserId: string | null,
  ): Promise<{
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  } | null> {
    if (stationId === 1 && planningAssigneeUserId) {
      const assigned = await this.prisma.user.findUnique({
        where: { id: planningAssigneeUserId },
        select: { firstName: true, lastName: true, photoUrl: true },
      });
      if (assigned) return assigned;
    }
    return this.prisma.user.findFirst({
      where: {
        managedStationId: stationId,
        role: { in: [SkyflowRole.STATION_MANAGER, SkyflowRole.SITE_MANAGER] },
      },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      select: { firstName: true, lastName: true, photoUrl: true },
    });
  }

  async getWorkerContext(projectId: string, stationId: number) {
    this.assertStation(stationId);
    const order = await this.ordersService.findOne(projectId);
    const totals = await this.ordersService.stationTotals(projectId);
    const scrapByStation = await this.ordersService.scrapTotals(projectId);

    const qty = (id: number) =>
      totals.find((t) => t.stationId === id)?.processedQty ?? 0;

    const previousStationId = stationId > 1 ? stationId - 1 : null;
    const previousQty =
      previousStationId === null ? order.totalItems : qty(previousStationId);

    const summaryStations = [1, 2, 3, 4].map((id) => ({
      stationId: id,
      labelKey: `STATION_${id}_SHORT`,
      processedQty: qty(id),
      scrapQty:
        scrapByStation.find((s) => s.stationId === id)?.scrapQty ?? 0,
    }));

    const packedQty = qty(6);
    const readyToShip = packedQty >= order.totalItems;

    const sawWorkLines =
      stationId === 1 && order.flowStatus === ProjectFlowStatus.IN_PRODUCTION
        ? await this.prisma.sawStationWorkLine.findMany({
            where: { projectId },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              componentKind: true,
              description: true,
              quantity: true,
              sortOrder: true,
            },
          })
        : undefined;

    let siteAssembly: Record<string, unknown> | undefined;
    if (stationId === 7) {
      const latest = await this.prisma.stationLog.findFirst({
        where: { projectId, stationId: 7 },
        orderBy: { createdAt: 'desc' },
      });
      const ep = assembledFromLogPayload(latest?.extraPayload);
      siteAssembly = {
        deliveryNoteUrl: order.siteDeliveryNotePath ?? null,
        expectedBeams: order.siteExpectedBeams ?? 0,
        expectedGlazing: order.siteExpectedGlazing ?? 0,
        expectedUnitized: order.siteExpectedUnitized ?? 0,
        assembledBeams: ep.beams,
        assembledGlazing: ep.glazing,
        assembledUnitized: ep.unitized,
      };
    }

    const stationManagerDisplay = await this.resolveStationManagerDisplay(
      stationId,
      order.planningAssigneeUserId,
    );

    return {
      order,
      stationId,
      previousQty,
      totals,
      scrapByStation,
      summaryStations,
      packedQty,
      requiredPackQty: order.totalItems,
      readyToShip,
      ...(stationManagerDisplay ? { stationManagerDisplay } : {}),
      ...(stationId === 1 &&
      order.flowStatus === ProjectFlowStatus.IN_PRODUCTION
        ? { sawWorkLines: sawWorkLines ?? [] }
        : {}),
      ...(siteAssembly ? { siteAssembly } : {}),
    };
  }

  /** After PDF/image upload: stub “scan” fills expected counts from order scope (replace with real OCR later). */
  async ingestSiteDeliveryNote(projectId: string, storedFilename: string) {
    const order = await this.ordersService.findOne(projectId);
    if (order.flowStatus === ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Approve planning before uploading the delivery note.',
      );
    }
    const publicPath = `/assets/site-delivery/${storedFilename}`;
    const n = order.totalItems;
    await this.prisma.projectOrder.update({
      where: { id: projectId },
      data: {
        siteDeliveryNotePath: publicPath,
        siteExpectedBeams: n,
        siteExpectedGlazing: n,
        siteExpectedUnitized: n,
      },
    });
    return {
      ok: true,
      deliveryNoteUrl: publicPath,
      expected: { beams: n, glazing: n, unitized: n },
    };
  }

  async createStationLog(stationId: number, dto: CreateStationLogDto) {
    this.assertStation(stationId);
    const orderRow = await this.ordersService.findOne(dto.projectId);

    if (orderRow.flowStatus === ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning not approved — all stations are locked until תפ״י is approved',
      );
    }

    if (stationId === 1 && dto.cutLength === undefined) {
      throw new BadRequestException('cutLength is required for station 1');
    }

    if (stationId === 7) {
      if (!orderRow.siteDeliveryNotePath) {
        throw new BadRequestException(
          'Upload the delivery note (תעודת משלוח) before reporting assembly.',
        );
      }
      const ep = dto.extraPayload as
        | Record<string, unknown>
        | undefined;
      const b = Number(ep?.['assembledBeams']);
      const g = Number(ep?.['assembledGlazing']);
      const u = Number(ep?.['assembledUnitized']);
      if (
        ![b, g, u].every((x) => Number.isFinite(x) && x >= 0)
      ) {
        throw new BadRequestException(
          'assembledBeams, assembledGlazing, assembledUnitized required (≥ 0)',
        );
      }
      dto = {
        ...dto,
        processedQty: 1,
        extraPayload: {
          assembledBeams: b,
          assembledGlazing: g,
          assembledUnitized: u,
        },
      };
    }

    const created = await this.prisma.stationLog.create({
      data: {
        projectId: dto.projectId,
        stationId,
        processedQty: dto.processedQty,
        issues: dto.issues ?? null,
        workerId: dto.workerId ?? null,
        cutLength: dto.cutLength ?? null,
        extraPayload: dto.extraPayload
          ? (dto.extraPayload as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return created;
  }

  async createScrapReport(stationId: number, dto: CreateScrapReportDto) {
    this.assertStation(stationId);
    const orderRow = await this.ordersService.findOne(dto.projectId);
    if (orderRow.flowStatus === ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning not approved — stations are locked',
      );
    }

    return this.prisma.scrapReport.create({
      data: {
        projectId: dto.projectId,
        stationId,
        itemLength: dto.itemLength,
        scrapQty: dto.scrapQty,
      },
    });
  }
}

/** Ensure upload directory exists (called from controller before multer). */
export function ensureSiteDeliveryDir(): string {
  const dir = siteDeliveryUploadDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
