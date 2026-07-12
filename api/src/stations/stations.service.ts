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
import { DeliveryNotesService } from '../delivery-notes/delivery-notes.service.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CreateStationLogDto } from './dto/create-station-log.dto.js';
import { CreateScrapReportDto } from './dto/create-scrap-report.dto.js';
import {
  assembledQtyMapFromLogPayload,
  assemblyTypeReportMapFromLogPayload,
  buildAssemblyPipelineLines,
  buildAssemblyWindowUnits,
  countAssemblyTypeReports,
  sumAssemblyWindowQty,
  type AssemblyStationContextDto,
} from '../common/assembly-context.util';
import {
  buildGluingStationContext,
  gluingDoneMapFromLogPayload,
  sumGluingProgress,
  type GluingStationContextDto,
} from '../common/gluing-context.util';
import { lineQtyFromLabel } from '../planning/planning-assembly-media';
import { loadAssemblyManifest } from '../planning/planning-assembly-media';

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
/**
 * 1–7 = production line; 8 = Laser station (ANG angles), after saws.
 * 9 = Steelwork (מסגריה) appendix reports — a virtual id used only to isolate
 * connection-details reports from station 1's saw totals; not a real line card.
 */
const MAX_STATION = 9;
/** Laser station id (conditional — only when angleSourcing = INTERNAL_LASER + ANG exist). */
export const LASER_STATION_ID = 8;
/** Virtual station id for steelwork (מסגריה) connection-details reports. */
export const STEELWORK_STATION_ID = 9;

/** Writable public folder for delivery-note PDFs (served by Angular dev server / static hosting). */
export function siteDeliveryUploadDir(): string {
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'site-delivery');
}

/** Writable public folder for station 6 pack report photos. */
export function packPhotoUploadDir(): string {
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'pack-photos');
}

/** Writable public folder for station 3 assembly TYPE report photos. */
export function assemblyPhotoUploadDir(): string {
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'assembly-photos');
}

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly deliveryNotes: DeliveryNotesService,
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

  /** מיזוג אחרון — מ״מ לשורה ממודאל מסור (תומך בדיווחים ישנים במטרים) */
  private async latestSawLineMmFromLogs(
    projectId: string,
  ): Promise<Record<string, number>> {
    const logs = await this.prisma.stationLog.findMany({
      where: { projectId, stationId: 1 },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: { extraPayload: true },
    });
    const lineMm = new Map<string, number>();
    for (const log of logs) {
      const ep = log.extraPayload as Record<string, unknown> | null;
      if (!ep?.['sawModalSnapshot']) continue;
      const bags: Record<string, unknown>[] = [];
      if (ep['sawLineMmById']) bags.push(ep['sawLineMmById'] as Record<string, unknown>);
      if (ep['sawLineMetersById']) {
        bags.push(ep['sawLineMetersById'] as Record<string, unknown>);
      }
      for (const bag of bags) {
        for (const [lineId, v] of Object.entries(bag)) {
          if (lineMm.has(lineId)) continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) continue;
          lineMm.set(lineId, this.normalizeSawLineLengthToMm(n));
        }
      }
    }
    return Object.fromEntries(lineMm);
  }

  /** דיווחים ישנים: ערך < 500 נחשב מטרים */
  private normalizeSawLineLengthToMm(n: number): number {
    if (n > 0 && n < 500) return Math.round(n * 1000);
    return Math.round(n);
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
            mm: log.cutLength != null ? Number(log.cutLength) : 0,
          },
        };
      }
      case 2:
      case 3:
      case 4: {
        const ep234 = log.extraPayload as Record<string, unknown> | null;
        if (ep234?.['gluingSnapshot']) {
          const kind = String(ep234['instructionKind'] ?? '');
          const approved = ep234['done'] === true;
          return {
            summaryKey: approved
              ? 'WORKER.ACT_LOG_GLUING_TYPE_DONE'
              : 'WORKER.ACT_LOG_GLUING_TYPE_UNDONE',
            summaryParams: { kind, qty },
          };
        }
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
      case STEELWORK_STATION_ID:
        return {
          summaryKey: 'WORKER.ACT_LOG_STEELWORK',
          summaryParams: { qty },
        };
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

    // Laser (station 8) is a parallel component station fed by ANG angles —
    // its target is the total angle quantity, not the previous line station.
    const laserStationCtx =
      stationId === LASER_STATION_ID
        ? await this.buildLaserStationContext(projectId)
        : undefined;

    const previousStationId = stationId > 1 ? stationId - 1 : null;
    const previousQty =
      stationId === LASER_STATION_ID
        ? (laserStationCtx?.totalAngleQty ?? 0)
        : previousStationId === null
          ? order.totalItems
          : qty(previousStationId);

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

    // Steelwork (מסגריה) — station 1 in STEEL mode gets a laser-style section
    // fed by the manually-uploaded "connection details & angles" appendix PDFs.
    const steelworkStationCtx =
      stationId === 1 && order.lineMaterial === 'STEEL' && inProduction
        ? await this.buildSteelworkStationContext(projectId)
        : undefined;

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
            planningCutLengthMm: true,
            sawsProfileCode: true,
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
    let sawWorkMmByLineId: Record<string, number> | undefined;
    let sawWorkSawnByKindPayload: Record<string, number> | undefined;
    if (
      stationId >= 1 &&
      stationId <= 4 &&
      inProduction &&
      sawWorkLines?.length
    ) {
      sawWorkSawnByLineId = await this.latestSawLineSawnFromLogs(projectId);
      sawWorkMmByLineId = await this.latestSawLineMmFromLogs(projectId);
    }
    if (inProduction && sawWorkLines?.length && sawWorkSawnByLineId) {
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
      const latestActiveNote = await this.prisma.projectDeliveryNote.findFirst({
        where: { projectId, status: 'ACTIVE' },
        orderBy: { issuedAt: 'desc' },
      });
      const deliveryUrl =
        latestActiveNote?.documentPath ?? order.siteDeliveryNotePath ?? null;
      const siteNotes = await this.deliveryNotes.buildSiteAssemblyNotes(
        projectId,
        latest?.createdAt ?? null,
      );
      siteAssembly = {
        deliveryNoteUrl: deliveryUrl,
        expectedBeams: order.siteExpectedBeams ?? 0,
        expectedGlazing: order.siteExpectedGlazing ?? 0,
        expectedUnitized: order.siteExpectedUnitized ?? 0,
        assembledBeams: ep.beams,
        assembledGlazing: ep.glazing,
        assembledUnitized: ep.unitized,
        shippingType: latestActiveNote?.shippingType ?? null,
        externalPrice: latestActiveNote?.externalPrice?.toString() ?? null,
        noteNumber: latestActiveNote?.noteNumber ?? null,
        issuedAt: latestActiveNote?.issuedAt?.toISOString() ?? null,
        awaitingDeliveryNote: siteNotes.notes.length === 0,
        hasNewDeliveryNote: siteNotes.hasNewDeliveryNote,
        deliveryNotes: siteNotes.notes,
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

    // Rework returned from the elevation map to this station.
    const reworkRows = await this.prisma.cellDefect.findMany({
      where: { projectId, returnedToStationId: stationId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: { cell: { select: { code: true, windowTypeCode: true } } },
    });
    const reworkDefects = reworkRows.map((d) => ({
      id: d.id,
      cellCode: d.cell.code,
      windowTypeCode: d.cell.windowTypeCode,
      reason: d.reason,
      createdAt: d.createdAt.toISOString(),
    }));

    let packReport:
      | {
          requiredCount: number;
          photos: { slotIndex: number; url: string }[];
          complete: boolean;
        }
      | undefined;
    let deliveryNote: Awaited<
      ReturnType<DeliveryNotesService['buildWorkerContext']>
    > | undefined;
    if (stationId === 6) {
      packReport = await this.buildPackReportContext(
        projectId,
        order.totalItems,
      );
      deliveryNote = await this.deliveryNotes.buildWorkerContext(
        projectId,
        packReport.complete,
      );
    }

    let gluingStation: GluingStationContextDto | undefined;
    if (stationId === 4 && inProduction) {
      const cncMap = sawWorkLines?.length
        ? await this.latestWorkLineDoneFromLogs(projectId, 2)
        : {};
      gluingStation = await this.buildGluingStationContext(
        projectId,
        sawWorkLines ?? [],
        cncMap,
      );
    }

    // New 4-PDF flow: assembly station shows the window production-instruction
    // PDFs + sets tables per window type.
    const assemblyWindowTypes =
      stationId === 3
        ? await this.buildAssemblyWindowTypeDocs(projectId)
        : undefined;

    let assemblyStation: AssemblyStationContextDto | undefined;
    if (stationId === 3 && inProduction) {
      const lines = sawWorkLines ?? [];
      const sawnMap =
        sawWorkSawnByLineId ??
        (lines.length
          ? await this.latestSawLineSawnFromLogs(projectId)
          : {});
      const cncMap = lines.length
        ? await this.latestWorkLineDoneFromLogs(projectId, 2)
        : {};
      assemblyStation = await this.buildAssemblyStationContext(
        projectId,
        lines,
        sawnMap,
        cncMap,
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
            sawWorkMmByLineId: sawWorkMmByLineId ?? {},
          }
        : {}),
      ...(stationId >= 1 &&
      stationId <= 4 &&
      inProduction &&
      sawWorkLines?.length &&
      sawWorkSawnByKindPayload
        ? {
            sawWorkSawnByKind: sawWorkSawnByKindPayload,
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
      ...(deliveryNote ? { deliveryNote } : {}),
      ...(assemblyStation ? { assemblyStation } : {}),
      ...(gluingStation ? { gluingStation } : {}),
      ...(laserStationCtx ? { laserStation: laserStationCtx } : {}),
      ...(steelworkStationCtx ? { steelworkStation: steelworkStationCtx } : {}),
      ...(assemblyWindowTypes?.length ? { assemblyWindowTypes } : {}),
      ...(reworkDefects.length ? { reworkDefects } : {}),
    };
  }

  /** Assembly (station 3) — window types with instruction PDFs + sets tables. */
  private async buildAssemblyWindowTypeDocs(projectId: string): Promise<
    {
      code: string;
      totalQty: number;
      hasAngles: boolean;
      angleCodes: string[];
      composition: string[];
      setLabels: string[];
      instructionPdfUrl: string | null;
      instructionPage: number | null;
    }[]
  > {
    const windowTypes = await this.prisma.windowType.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      include: { instructionDoc: { select: { pdfPath: true } } },
    });
    return windowTypes.map((w) => ({
      code: w.code,
      totalQty: w.totalQty,
      hasAngles: w.hasAngles,
      angleCodes: (Array.isArray(w.angleCodes) ? w.angleCodes : []) as string[],
      composition: (Array.isArray(w.composition)
        ? w.composition
        : []) as string[],
      setLabels: (Array.isArray(w.setsPayload) ? w.setsPayload : []) as string[],
      instructionPdfUrl: w.instructionDoc?.pdfPath ?? null,
      instructionPage: w.instructionPage,
    }));
  }

  /** Laser station (8) — ANG angles + quantities + instruction PDFs. */
  private async buildLaserStationContext(projectId: string): Promise<{
    angles: {
      code: string;
      qty: number;
      doneQty: number;
      instructionPdfUrl: string | null;
      instructionPage: number | null;
    }[];
    totalAngleQty: number;
    doneQty: number;
    externalSupplier: boolean;
  }> {
    const [angles, order, logs] = await Promise.all([
      this.prisma.angle.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { instructionDoc: { select: { pdfPath: true } } },
      }),
      this.prisma.projectOrder.findUnique({
        where: { id: projectId },
        select: { angleSourcing: true },
      }),
      this.prisma.stationLog.findMany({
        where: { projectId, stationId: LASER_STATION_ID },
        select: { processedQty: true, extraPayload: true },
      }),
    ]);

    // סכימת הכמות שדווחה לכל ANG לפי angleCode שנשמר ב-extraPayload.
    const doneByCode = new Map<string, number>();
    for (const log of logs) {
      const ep = log.extraPayload as Record<string, unknown> | null;
      const code = typeof ep?.['angleCode'] === 'string' ? (ep['angleCode'] as string) : null;
      if (!code) continue;
      doneByCode.set(code, (doneByCode.get(code) ?? 0) + log.processedQty);
    }

    const totalAngleQty = angles.reduce((s, a) => s + a.qty, 0);
    const doneQty = [...doneByCode.values()].reduce((s, n) => s + n, 0);
    return {
      angles: angles.map((a) => ({
        code: a.code,
        qty: a.qty,
        doneQty: doneByCode.get(a.code) ?? 0,
        instructionPdfUrl: a.instructionDoc?.pdfPath ?? null,
        instructionPage: a.instructionPage,
      })),
      totalAngleQty,
      doneQty,
      externalSupplier: order?.angleSourcing === 'EXTERNAL_SUPPLIER',
    };
  }

  /**
   * Steelwork station (1, STEEL) — "connection details & angles" appendix PDFs
   * uploaded by planning + per-detail reported quantities. Mirrors the laser
   * station shape. Reports live in StationLog(stationId=STEELWORK_STATION_ID)
   * with an extraPayload.steelworkDetailId, isolated from station 1 saw reports.
   */
  private async buildSteelworkStationContext(projectId: string): Promise<{
    details: {
      id: string;
      title: string;
      targetQty: number;
      doneQty: number;
      instructionPdfUrl: string | null;
    }[];
    totalTargetQty: number;
    doneQty: number;
  }> {
    const [details, logs] = await Promise.all([
      this.prisma.steelworkDetail.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { instructionDoc: { select: { pdfPath: true } } },
      }),
      this.prisma.stationLog.findMany({
        where: { projectId, stationId: STEELWORK_STATION_ID },
        select: { processedQty: true, extraPayload: true },
      }),
    ]);

    // כמות שדווחה לכל נספח לפי steelworkDetailId שנשמר ב-extraPayload.
    const doneById = new Map<string, number>();
    for (const log of logs) {
      const ep = log.extraPayload as Record<string, unknown> | null;
      const id =
        typeof ep?.['steelworkDetailId'] === 'string'
          ? (ep['steelworkDetailId'] as string)
          : null;
      if (!id) continue;
      doneById.set(id, (doneById.get(id) ?? 0) + log.processedQty);
    }

    const totalTargetQty = details.reduce((s, d) => s + d.targetQty, 0);
    const doneQty = [...doneById.values()].reduce((s, n) => s + n, 0);
    return {
      details: details.map((d) => ({
        id: d.id,
        title: d.title,
        targetQty: d.targetQty,
        doneQty: doneById.get(d.id) ?? 0,
        instructionPdfUrl: d.instructionDoc?.pdfPath ?? null,
      })),
      totalTargetQty,
      doneQty,
    };
  }

  private async latestGluingDoneByKind(
    projectId: string,
  ): Promise<Record<string, boolean>> {
    const latest = await this.prisma.stationLog.findFirst({
      where: { projectId, stationId: 4 },
      orderBy: { createdAt: 'desc' },
      select: { extraPayload: true },
    });
    return gluingDoneMapFromLogPayload(latest?.extraPayload);
  }

  private async buildGluingStationContext(
    projectId: string,
    sawWorkLines: {
      id: string;
      instructionKind: string;
      quantity: number;
    }[],
    cncByLineId: Record<string, number>,
  ): Promise<GluingStationContextDto> {
    const items = await this.prisma.productItem.findMany({
      where: { projectId },
      select: {
        id: true,
        label: true,
        instructionKind: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    const gluingDoneByKind = await this.latestGluingDoneByKind(projectId);
    return buildGluingStationContext(
      items,
      sawWorkLines,
      cncByLineId,
      gluingDoneByKind,
    );
  }

  async setGluingTypeDone(
    projectId: string,
    instructionKind: string,
    done: boolean,
    reporterUserId: string | null,
  ) {
    this.assertStation(4);
    const order = await this.ordersService.findOne(projectId);
    if (order.flowStatus !== ProjectFlowStatus.IN_PRODUCTION) {
      throw new BadRequestException('Project is not in production');
    }

    const kind = instructionKind.trim();
    if (!kind) {
      throw new BadRequestException('instructionKind is required');
    }

    const sawWorkLines = await this.prisma.sawStationWorkLine.findMany({
      where: { projectId },
      select: { id: true, instructionKind: true, quantity: true },
    });
    const cncMap = sawWorkLines.length
      ? await this.latestWorkLineDoneFromLogs(projectId, 2)
      : {};
    const ctx = await this.buildGluingStationContext(
      projectId,
      sawWorkLines,
      cncMap,
    );
    const group = ctx.groups.find((g) => g.instructionKind === kind);
    if (!group) {
      throw new BadRequestException('No GL units for this TYPE in planning');
    }
    if (done && group.locked) {
      throw new BadRequestException('CNC is not complete for this TYPE yet');
    }

    const map = await this.latestGluingDoneByKind(projectId);
    if (done) map[kind] = true;
    else delete map[kind];

    const nextGroups = ctx.groups.map((g) => ({
      ...g,
      done: map[g.instructionKind] === true,
    }));
    const { doneGlUnitQty } = sumGluingProgress(nextGroups);

    await this.prisma.stationLog.create({
      data: {
        projectId,
        stationId: 4,
        processedQty: doneGlUnitQty,
        workerId: reporterUserId,
        extraPayload: {
          gluingSnapshot: true,
          instructionKind: kind,
          done,
          gluingDoneByInstructionKind: map,
        },
      },
    });

    const fresh = await this.buildGluingStationContext(
      projectId,
      sawWorkLines,
      cncMap,
    );

    return {
      ok: true,
      instructionKind: kind,
      done,
      gluingStation: fresh,
    };
  }

  private async latestAssembledWindowQtyMap(
    projectId: string,
    windowItems: { id: string; label: string }[],
  ): Promise<Record<string, number>> {
    const latest = await this.prisma.stationLog.findFirst({
      where: { projectId, stationId: 3 },
      orderBy: { createdAt: 'desc' },
      select: { extraPayload: true },
    });
    const ep = latest?.extraPayload as Record<string, unknown> | null;
    const map = assembledQtyMapFromLogPayload(ep);
    if (
      ep &&
      Array.isArray(ep['assembledProductItemIds']) &&
      !ep['assembledQtyByItemId']
    ) {
      for (const item of windowItems) {
        if (map[item.id]) {
          map[item.id] = lineQtyFromLabel(item.label);
        }
      }
    }
    return map;
  }

  private async buildAssemblyStationContext(
    projectId: string,
    sawWorkLines: {
      id: string;
      instructionKind: string;
      description: string;
      quantity: number;
      sortOrder: number;
      imagePaths: string[];
      sawsProfileCode: string | null;
      planningCutLengthMm: number | null;
    }[],
    sawnByLineId: Record<string, number>,
    cncByLineId: Record<string, number>,
  ): Promise<AssemblyStationContextDto> {
    const windowItems = await this.prisma.productItem.findMany({
      where: {
        projectId,
        instructionKind: 'WINDOW_INSTRUCTION',
      },
      include: { components: true },
      orderBy: { sortOrder: 'asc' },
    });

    const manifest = loadAssemblyManifest(projectId);
    const assembledQtyById = await this.latestAssembledWindowQtyMap(
      projectId,
      windowItems.map((i) => ({ id: i.id, label: i.label })),
    );

    const pipeline = buildAssemblyPipelineLines(
      sawWorkLines,
      sawnByLineId,
      cncByLineId,
    );
    const windows = buildAssemblyWindowUnits(
      windowItems,
      manifest?.itemImages ?? {},
      assembledQtyById,
    );
    const { totalQty, assembledQty } = sumAssemblyWindowQty(windows);
    const typeReportByKind = await this.latestAssemblyTypeReportMap(projectId);
    const { typesReportedCount, typesReportTarget } = countAssemblyTypeReports(
      pipeline,
      typeReportByKind,
    );

    return {
      pipeline,
      windows,
      pipelineReadyCount: pipeline.filter((p) => p.status === 'ready').length,
      pipelineTotalCount: pipeline.length,
      windowsUnitCount: windows.length,
      windowsTotalQty: totalQty,
      windowsAssembledQty: assembledQty,
      typeReportByKind,
      typesReportedCount,
      typesReportTarget,
    };
  }

  private async latestAssemblyTypeReportMap(
    projectId: string,
  ): Promise<Record<string, { reported: boolean; photoUrl: string | null }>> {
    const latest = await this.prisma.stationLog.findFirst({
      where: { projectId, stationId: 3 },
      orderBy: { createdAt: 'desc' },
      select: { extraPayload: true },
    });
    return assemblyTypeReportMapFromLogPayload(latest?.extraPayload);
  }

  async submitAssemblyTypeReport(
    projectId: string,
    instructionKind: string,
    photoFilename: string,
    reporterUserId: string | null,
  ) {
    this.assertStation(3);
    const order = await this.ordersService.findOne(projectId);
    if (order.flowStatus !== ProjectFlowStatus.IN_PRODUCTION) {
      throw new BadRequestException('Project is not in production');
    }

    const kind = instructionKind.trim();
    if (!kind) {
      throw new BadRequestException('instructionKind is required');
    }

    const sawWorkLines = await this.prisma.sawStationWorkLine.findMany({
      where: { projectId },
      select: {
        id: true,
        instructionKind: true,
        description: true,
        quantity: true,
        sortOrder: true,
        imagePaths: true,
        sawsProfileCode: true,
        planningCutLengthMm: true,
      },
    });
    const sawnMap = sawWorkLines.length
      ? await this.latestSawLineSawnFromLogs(projectId)
      : {};
    const cncMap = sawWorkLines.length
      ? await this.latestWorkLineDoneFromLogs(projectId, 2)
      : {};
    const pipeline = buildAssemblyPipelineLines(
      sawWorkLines,
      sawnMap,
      cncMap,
    );
    const readyForKind = pipeline.some(
      (l) => (l.instructionKind ?? '').trim() === kind && l.status === 'ready',
    );
    if (!readyForKind) {
      throw new BadRequestException('TYPE is not ready for assembly report');
    }

    const photoUrl = `/assets/assembly-photos/${photoFilename}`;
    const reportMap = await this.latestAssemblyTypeReportMap(projectId);
    reportMap[kind] = { reported: true, photoUrl };

    const windowItems = await this.prisma.productItem.findMany({
      where: { projectId, instructionKind: 'WINDOW_INSTRUCTION' },
      select: { id: true, label: true },
    });
    const assembledMap = await this.latestAssembledWindowQtyMap(
      projectId,
      windowItems,
    );
    const { totalQty, assembledQty: sumAsm } = sumAssemblyWindowQty(
      windowItems.map((w) => ({
        quantity: lineQtyFromLabel(w.label),
        assembledQty: assembledMap[w.id] ?? 0,
      })),
    );

    await this.prisma.stationLog.create({
      data: {
        projectId,
        stationId: 3,
        processedQty: sumAsm,
        workerId: reporterUserId,
        extraPayload: {
          assemblyTypeReportSnapshot: true,
          instructionKind: kind,
          assemblyTypeReportByKind: reportMap,
          assembledQtyByItemId: assembledMap,
        },
      },
    });

    const fresh = await this.buildAssemblyStationContext(
      projectId,
      sawWorkLines,
      sawnMap,
      cncMap,
    );

    return {
      ok: true,
      instructionKind: kind,
      photoUrl,
      assemblyStation: fresh,
    };
  }

  async setAssemblyWindowQty(
    projectId: string,
    productItemId: string,
    assembledQty: number,
    reporterUserId: string | null,
  ) {
    this.assertStation(3);
    const order = await this.ordersService.findOne(projectId);
    if (order.flowStatus !== ProjectFlowStatus.IN_PRODUCTION) {
      throw new BadRequestException('Project is not in production');
    }

    const item = await this.prisma.productItem.findFirst({
      where: { projectId, id: productItemId },
      select: { id: true, instructionKind: true, label: true },
    });
    if (!item || item.instructionKind !== 'WINDOW_INSTRUCTION') {
      throw new BadRequestException('Window instruction unit not found');
    }

    const windowItems = await this.prisma.productItem.findMany({
      where: { projectId, instructionKind: 'WINDOW_INSTRUCTION' },
      select: { id: true, label: true },
    });
    const map = await this.latestAssembledWindowQtyMap(projectId, windowItems);
    const maxQty = lineQtyFromLabel(item.label);
    const next = Math.min(maxQty, Math.max(0, Math.floor(Number(assembledQty) || 0)));
    if (next <= 0) delete map[productItemId];
    else map[productItemId] = next;

    const { totalQty, assembledQty: sumAsm } = sumAssemblyWindowQty(
      windowItems.map((w) => ({
        quantity: lineQtyFromLabel(w.label),
        assembledQty: map[w.id] ?? 0,
      })),
    );

    await this.prisma.stationLog.create({
      data: {
        projectId,
        stationId: 3,
        processedQty: sumAsm,
        workerId: reporterUserId,
        extraPayload: {
          assemblyWindowSnapshot: true,
          assembledQtyByItemId: map,
        },
      },
    });

    return {
      ok: true,
      productItemId,
      assembledQty: next,
      quantity: maxQty,
      windowsAssembledQty: sumAsm,
      windowsTotalQty: totalQty,
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
      const activeNote = await this.prisma.projectDeliveryNote.findFirst({
        where: { projectId: dto.projectId, status: 'ACTIVE' },
      });
      if (!activeNote) {
        throw new BadRequestException(
          'A delivery note must be issued from pack station before reporting assembly.',
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

    const profileCode = (dto.profileCode ?? 'LEGACY').trim().slice(0, 32) || 'LEGACY';
    const profileKind =
      dto.profileKind === 'DRAWN' || dto.profileKind === 'CATALOG'
        ? dto.profileKind
        : profileCode.match(/^MP[SB]-[XY]$/i)
          ? 'CATALOG'
          : 'DRAWN';

    return this.prisma.scrapReport.create({
      data: {
        projectId: dto.projectId,
        stationId,
        itemLength: dto.itemLength,
        scrapQty: dto.scrapQty,
        profileKind,
        profileCode: profileCode.toUpperCase(),
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

export function ensureAssemblyPhotoDir(): string {
  const dir = assemblyPhotoUploadDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
