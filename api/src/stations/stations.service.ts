import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  ProjectFlowStatus,
  ProjectOrder,
  SkyflowRole,
} from '@prisma/client';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  assembledFromLogPayload,
  computeSiteAssemblyPercent,
} from '../common/site-assembly.util';
import { packPhotoRequiredCount, MAX_PACK_PHOTO_SLOTS } from '../common/pack-photo.util';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CreateStationLogDto } from './dto/create-station-log.dto.js';
import { CreateScrapReportDto } from './dto/create-scrap-report.dto.js';

export type WorkerActivityLogEntry = {
  id: string;
  createdAt: string;
  stationId: number;
  stationManagerName: string;
  reporterName: string | null;
  processedQty: number;
  summaryKey: string;
  summaryParams: Record<string, string | number>;
  issues: string | null;
};

const MIN_STATION = 1;
const MAX_STATION = 7;

/** Writable public folder for delivery-note PDFs (served by Angular dev server / static hosting). */
export function siteDeliveryUploadDir(): string {
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'site-delivery');
}

/** Writable public folder for station 6 pack report photos. */
export function packPhotoUploadDir(): string {
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'pack-photos');
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

  /**
   * שורות מסור שנוצרו לפני שדה instructionKind — ממלאים מ־ProductItem לפי
   * קידומת `[item.label]` בתיאור. ה־label עצמו מתחיל ב־`[שם גיליון]` —
   * לכן התיאור הוא `[[Type 2] …] תיאור` וחייבים איזון סוגריים, לא regex ל־] הראשון.
   */
  private async backfillSawWorkLinesInstructionKinds(
    projectId: string,
    lines: {
      id: string;
      description: string;
      instructionKind: string;
    }[],
  ): Promise<void> {
    const missing = lines.filter((l) => !(l.instructionKind ?? '').trim());
    if (!missing.length) return;

    const productItemLabelFromSawDescription = (
      description: string,
    ): string | null => {
      const t = description.trim();
      if (!t.startsWith('[')) return null;
      let depth = 0;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            const inner = t.slice(1, i).trim();
            return inner.length ? inner : null;
          }
        }
      }
      return null;
    };

    const labels = new Set<string>();
    for (const l of missing) {
      const lb = productItemLabelFromSawDescription(l.description);
      if (lb) labels.add(lb);
    }
    if (!labels.size) return;

    const items = await this.prisma.productItem.findMany({
      where: { projectId, label: { in: [...labels] } },
      select: { label: true, instructionKind: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    const byLabel = new Map<string, string>();
    for (const i of items) {
      const k = (i.instructionKind ?? '').trim();
      if (!k || k === 'WINDOW_INSTRUCTION') continue;
      if (!byLabel.has(i.label)) byLabel.set(i.label, k);
    }

    const toWrite: { id: string; instructionKind: string }[] = [];
    for (const line of missing) {
      const lb = productItemLabelFromSawDescription(line.description);
      if (!lb) continue;
      const kind = byLabel.get(lb);
      if (!kind?.trim()) continue;
      line.instructionKind = kind;
      toWrite.push({ id: line.id, instructionKind: kind });
    }
    if (!toWrite.length) return;

    const chunkSize = 80;
    for (let i = 0; i < toWrite.length; i += chunkSize) {
      const chunk = toWrite.slice(i, i + chunkSize);
      await this.prisma.$transaction(
        chunk.map((u) =>
          this.prisma.sawStationWorkLine.update({
            where: { id: u.id },
            data: { instructionKind: u.instructionKind },
          }),
        ),
      );
    }
  }

  /** מיזוג אחרון מדיווחי מודאל מסור (שורה → כמות שנוסרה) */
  private async latestSawLineSawnFromLogs(
    projectId: string,
  ): Promise<Record<string, number>> {
    const logs = await this.prisma.stationLog.findMany({
      where: { projectId, stationId: 1 },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: { extraPayload: true },
    });
    const lineSawn = new Map<string, number>();
    for (const log of logs) {
      const ep = log.extraPayload as Record<string, unknown> | null;
      if (!ep?.['sawModalSnapshot'] || !ep['sawLineSawnById']) continue;
      const bag = ep['sawLineSawnById'] as Record<string, unknown>;
      for (const [lineId, v] of Object.entries(bag)) {
        if (lineSawn.has(lineId)) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) {
          lineSawn.set(lineId, Math.floor(n));
        }
      }
    }
    return Object.fromEntries(lineSawn);
  }

  /** מיזוג אחרון — מטרים לשורה ממודאל מסור */
  private async latestSawLineMetersFromLogs(
    projectId: string,
  ): Promise<Record<string, number>> {
    const logs = await this.prisma.stationLog.findMany({
      where: { projectId, stationId: 1 },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: { extraPayload: true },
    });
    const lineMeters = new Map<string, number>();
    for (const log of logs) {
      const ep = log.extraPayload as Record<string, unknown> | null;
      if (!ep?.['sawModalSnapshot'] || !ep['sawLineMetersById']) continue;
      const bag = ep['sawLineMetersById'] as Record<string, unknown>;
      for (const [lineId, v] of Object.entries(bag)) {
        if (lineMeters.has(lineId)) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) {
          lineMeters.set(lineId, Math.round(n * 100) / 100);
        }
      }
    }
    return Object.fromEntries(lineMeters);
  }

  /** מיזוג אחרון מדיווחי מודאל תחנות 2–4 (שורה → כמות שדווחה בעמדה) */
  private async latestWorkLineDoneFromLogs(
    projectId: string,
    stationId: number,
  ): Promise<Record<string, number>> {
    const logs = await this.prisma.stationLog.findMany({
      where: { projectId, stationId },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: { extraPayload: true },
    });
    const lineDone = new Map<string, number>();
    for (const log of logs) {
      const ep = log.extraPayload as Record<string, unknown> | null;
      if (!ep?.['workLineModalSnapshot'] || !ep['lineQtyById']) continue;
      const bag = ep['lineQtyById'] as Record<string, unknown>;
      for (const [lineId, v] of Object.entries(bag)) {
        if (lineDone.has(lineId)) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) {
          lineDone.set(lineId, Math.floor(n));
        }
      }
    }
    return Object.fromEntries(lineDone);
  }

  private aggregateSawnByKind(
    lines: { id: string; instructionKind: string }[],
    lineSawn: Record<string, number>,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const line of lines) {
      const kind = (line.instructionKind ?? '').trim();
      if (!kind || kind === 'WINDOW_INSTRUCTION') continue;
      const n = lineSawn[line.id] ?? 0;
      if (n <= 0) continue;
      out[kind] = (out[kind] ?? 0) + n;
    }
    return out;
  }

  /** שם ותמונה להצגה במסוף עובד — לעמדה 1: מנהל משובץ מתכנון, אחרת משווה ישן, אחרת מנהל עמדה מהמערכת */
  private async resolveStationManagerDisplay(
    stationId: number,
    planningSawsManagerUserId: string | null,
    planningAssigneeUserId: string | null,
  ): Promise<{
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  } | null> {
    if (stationId === 1 && planningSawsManagerUserId) {
      const mgr = await this.prisma.user.findUnique({
        where: { id: planningSawsManagerUserId },
        select: { firstName: true, lastName: true, photoUrl: true },
      });
      if (mgr) return mgr;
    }
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

  private displayName(
    u: { firstName: string; lastName: string } | null,
  ): string {
    if (!u) return '—';
    const n = `${u.firstName} ${u.lastName}`.trim();
    return n.length ? n : '—';
  }

  private summaryForLog(log: {
    stationId: number;
    processedQty: number;
    cutLength: Prisma.Decimal | null;
    extraPayload: unknown;
  }): { summaryKey: string; summaryParams: Record<string, string | number> } {
    const qty = Math.max(0, log.processedQty);
    switch (log.stationId) {
      case 1: {
        const ep = log.extraPayload as Record<string, unknown> | null;
        if (ep?.['sawModalSnapshot']) {
          const raw = ep['sawLineSawnById'] as
            | Record<string, unknown>
            | undefined;
          const linesSum = raw
            ? Object.values(raw).reduce<number>(
                (s, v) =>
                  s +
                  (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0),
                0,
              )
            : 0;
          return {
            summaryKey: 'WORKER.ACT_LOG_SAW_MODAL',
            summaryParams: {
              kind: String(ep['instructionKind'] ?? ''),
              lines: linesSum,
            },
          };
        }
        return {
          summaryKey: 'WORKER.ACT_LOG_S1',
          summaryParams: {
            qty,
            cm: log.cutLength != null ? Number(log.cutLength) : 0,
          },
        };
      }
      case 2:
      case 3:
      case 4: {
        const ep234 = log.extraPayload as Record<string, unknown> | null;
        if (ep234?.['workLineModalSnapshot']) {
          const raw = ep234['lineQtyById'] as
            | Record<string, unknown>
            | undefined;
          const linesSum = raw
            ? Object.values(raw).reduce<number>(
                (s, v) =>
                  s +
                  (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0),
                0,
              )
            : 0;
          return {
            summaryKey: 'WORKER.ACT_LOG_WORK_LINE_MODAL',
            summaryParams: {
              station: log.stationId,
              kind: String(ep234['instructionKind'] ?? ''),
              lines: linesSum,
            },
          };
        }
        if (log.stationId === 2) {
          return { summaryKey: 'WORKER.ACT_LOG_S2', summaryParams: { qty } };
        }
        if (log.stationId === 3) {
          return { summaryKey: 'WORKER.ACT_LOG_S3', summaryParams: { qty } };
        }
        return { summaryKey: 'WORKER.ACT_LOG_S4', summaryParams: { qty } };
      }
      case 5:
        return { summaryKey: 'WORKER.ACT_LOG_S5', summaryParams: { qty } };
      case 6:
        return { summaryKey: 'WORKER.ACT_LOG_S6', summaryParams: { qty } };
      case 7: {
        const ep = log.extraPayload as Record<string, unknown> | null;
        return {
          summaryKey: 'WORKER.ACT_LOG_S7',
          summaryParams: {
            b: Number(ep?.['assembledBeams'] ?? 0),
            g: Number(ep?.['assembledGlazing'] ?? 0),
            u: Number(ep?.['assembledUnitized'] ?? 0),
          },
        };
      }
      default:
        return {
          summaryKey: 'WORKER.ACT_LOG_GENERIC',
          summaryParams: { qty, station: log.stationId },
        };
    }
  }

  private async buildActivityLog(
    projectId: string,
    order: ProjectOrder,
  ): Promise<WorkerActivityLogEntry[]> {
    const logs = await this.prisma.stationLog.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        stationId: true,
        processedQty: true,
        cutLength: true,
        extraPayload: true,
        issues: true,
        workerId: true,
        createdAt: true,
      },
    });
    if (!logs.length) return [];

    const reporterIds = [
      ...new Set(logs.map((l) => l.workerId).filter((x): x is string => !!x)),
    ];
    const reporters = reporterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const reporterNameById = new Map(
      reporters.map((u) => [
        u.id,
        `${u.firstName} ${u.lastName}`.trim() || '—',
      ]),
    );

    const managerByStation = new Map<number, string>();
    for (let sid = MIN_STATION; sid <= MAX_STATION; sid++) {
      const disp = await this.resolveStationManagerDisplay(
        sid,
        order.planningSawsManagerUserId ?? null,
        order.planningAssigneeUserId ?? null,
      );
      managerByStation.set(sid, this.displayName(disp));
    }

    return logs.map((log) => {
      const sm = this.summaryForLog(log);
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        stationId: log.stationId,
        stationManagerName: managerByStation.get(log.stationId) ?? '—',
        reporterName: log.workerId
          ? (reporterNameById.get(log.workerId) ?? null)
          : null,
        processedQty: log.processedQty,
        summaryKey: sm.summaryKey,
        summaryParams: sm.summaryParams,
        issues: log.issues?.trim() || null,
      };
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

    const inProduction = order.flowStatus === ProjectFlowStatus.IN_PRODUCTION;
    const loadSawWorkLines =
      inProduction && stationId >= 1 && stationId <= 4;

    const sawWorkLines = loadSawWorkLines
      ? await this.prisma.sawStationWorkLine.findMany({
          where: { projectId },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            componentKind: true,
            description: true,
            quantity: true,
            sortOrder: true,
            imagePaths: true,
            instructionKind: true,
            planningCutLengthCm: true,
          },
        })
      : undefined;

    if (sawWorkLines?.length) {
      await this.backfillSawWorkLinesInstructionKinds(projectId, sawWorkLines);
    }

    const sawWorkTargetQty =
      loadSawWorkLines &&
      sawWorkLines?.length
        ? sawWorkLines.reduce((s, l) => s + l.quantity, 0)
        : undefined;

    let sawWorkSawnByLineId: Record<string, number> | undefined;
    let sawWorkMetersByLineId: Record<string, number> | undefined;
    let sawWorkSawnByKindPayload: Record<string, number> | undefined;
    if (
      stationId >= 1 &&
      stationId <= 4 &&
      inProduction &&
      sawWorkLines?.length
    ) {
      sawWorkSawnByLineId = await this.latestSawLineSawnFromLogs(projectId);
      sawWorkMetersByLineId = await this.latestSawLineMetersFromLogs(
        projectId,
      );
    }
    if (
      stationId === 1 &&
      inProduction &&
      sawWorkLines?.length &&
      sawWorkSawnByLineId
    ) {
      sawWorkSawnByKindPayload = this.aggregateSawnByKind(
        sawWorkLines,
        sawWorkSawnByLineId,
      );
    }

    let workLineDoneByLineId: Record<string, number> | undefined;
    if (
      stationId >= 2 &&
      stationId <= 4 &&
      inProduction &&
      sawWorkLines?.length
    ) {
      workLineDoneByLineId = await this.latestWorkLineDoneFromLogs(
        projectId,
        stationId,
      );
    }

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
      order.planningSawsManagerUserId ?? null,
      order.planningAssigneeUserId ?? null,
    );

    let planningSawsTeam:
      | { firstName: string; lastName: string; photoUrl: string | null }[]
      | undefined;
    if (
      stationId === 1 &&
      order.flowStatus === ProjectFlowStatus.IN_PRODUCTION
    ) {
      const rows = await this.prisma.projectPlanningSawsWorker.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: {
          user: {
            select: { firstName: true, lastName: true, photoUrl: true },
          },
        },
      });
      if (rows.length) {
        planningSawsTeam = rows.map((r) => ({
          firstName: r.user.firstName,
          lastName: r.user.lastName,
          photoUrl: r.user.photoUrl,
        }));
      }
    }

    const activityLog = await this.buildActivityLog(projectId, order);

    let packReport:
      | {
          requiredCount: number;
          photos: { slotIndex: number; url: string }[];
          complete: boolean;
        }
      | undefined;
    if (stationId === 6) {
      packReport = await this.buildPackReportContext(
        projectId,
        order.totalItems,
      );
    }

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
      activityLog,
      ...(stationManagerDisplay ? { stationManagerDisplay } : {}),
      ...(planningSawsTeam?.length ? { planningSawsTeam } : {}),
      ...(loadSawWorkLines
        ? {
            sawWorkLines: sawWorkLines ?? [],
            ...(sawWorkTargetQty != null && sawWorkTargetQty > 0
              ? { sawWorkTargetQty }
              : {}),
          }
        : {}),
      ...(stationId >= 1 &&
      stationId <= 4 &&
      inProduction &&
      sawWorkLines?.length
        ? {
            sawWorkSawnByLineId: sawWorkSawnByLineId ?? {},
            sawWorkMetersByLineId: sawWorkMetersByLineId ?? {},
          }
        : {}),
      ...(stationId === 1 && inProduction && sawWorkLines?.length
        ? {
            sawWorkSawnByKind: sawWorkSawnByKindPayload ?? {},
          }
        : {}),
      ...(stationId >= 2 &&
      stationId <= 4 &&
      inProduction &&
      sawWorkLines?.length
        ? { workLineDoneByLineId: workLineDoneByLineId ?? {} }
        : {}),
      ...(siteAssembly ? { siteAssembly } : {}),
      ...(packReport ? { packReport } : {}),
    };
  }

  private async buildPackReportContext(
    projectId: string,
    totalItems: number,
  ): Promise<{
    requiredCount: number;
    photos: { slotIndex: number; url: string }[];
    complete: boolean;
  }> {
    const requiredCount = packPhotoRequiredCount(totalItems);
    const rows = await this.prisma.packReportPhoto.findMany({
      where: { projectId },
      orderBy: { slotIndex: 'asc' },
    });
    const photos = rows.map((r) => ({
      slotIndex: r.slotIndex,
      url: r.imagePath,
    }));
    const complete = Array.from({ length: requiredCount }, (_, i) =>
      photos.some((p) => p.slotIndex === i),
    ).every(Boolean);
    return {
      requiredCount,
      photos,
      complete,
    };
  }

  async ingestPackPhoto(
    projectId: string,
    slotIndex: number,
    filename: string,
    reporterUserId: string | null,
  ) {
    const orderRow = await this.ordersService.findOne(projectId);
    if (orderRow.flowStatus === ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning not approved — stations are locked',
      );
    }

    const requiredCount = packPhotoRequiredCount(orderRow.totalItems);
    if (
      !Number.isInteger(slotIndex) ||
      slotIndex < 0 ||
      slotIndex >= MAX_PACK_PHOTO_SLOTS
    ) {
      throw new BadRequestException('Invalid photo slot index');
    }

    const publicPath = `/assets/pack-photos/${filename}`;

    await this.prisma.packReportPhoto.upsert({
      where: {
        projectId_slotIndex: { projectId, slotIndex },
      },
      create: {
        projectId,
        slotIndex,
        imagePath: publicPath,
      },
      update: {
        imagePath: publicPath,
      },
    });

    const packReport = await this.buildPackReportContext(
      projectId,
      orderRow.totalItems,
    );

    if (packReport.complete) {
      const totals = await this.ordersService.stationTotals(projectId);
      const packed =
        totals.find((t) => t.stationId === 6)?.processedQty ?? 0;
      const remaining = Math.max(0, orderRow.totalItems - packed);
      if (remaining > 0) {
        await this.prisma.stationLog.create({
          data: {
            projectId,
            stationId: 6,
            processedQty: remaining,
            workerId: reporterUserId,
            extraPayload: {
              packPhotoReport: true,
              photoCount: packReport.photos.length,
            },
          },
        });
      }
    }

    return { ok: true, ...packReport };
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

  async createStationLog(
    stationId: number,
    dto: CreateStationLogDto,
    reporterUserId: string | null,
  ) {
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
        workerId: dto.workerId ?? reporterUserId ?? null,
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

export function ensurePackPhotoDir(): string {
  const dir = packPhotoUploadDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
