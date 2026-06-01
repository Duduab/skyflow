import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, ProjectFlowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CATALOG_PROFILE_CODES,
  aggregateScrapReports,
} from '../common/profile-inventory.js';
import {
  averageOverallLinePercent,
  siteLinePercentFromOrderRow,
} from './line-progress.util';
import { resolveStationDisplayNameHe } from '../common/station-presentation.util.js';

const STATION_ORDER = [1, 2, 3, 4, 5, 6, 7] as const;

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function pickMaxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

type OpenedByRow = {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
};

function mapOpenedBy(
  ...candidates: (OpenedByRow | null | undefined)[]
): OpenedByRow | null {
  for (const u of candidates) {
    if (u) {
      return {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        photoUrl: u.photoUrl,
      };
    }
  }
  return null;
}

const openedByUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  photoUrl: true,
} as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(projectId?: string) {
    let scopeId: string | undefined;
    if (projectId?.trim()) {
      const row = await this.prisma.projectOrder.findUnique({
        where: { id: projectId.trim() },
        select: { id: true },
      });
      if (row) scopeId = row.id;
    }

    const logWhere = scopeId ? { projectId: scopeId } : {};
    const scrapWhere = scopeId ? { projectId: scopeId } : {};

    const today = startOfUtcDay(new Date());
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - 6);

    const [
      orders,
      activeOrders,
      logCount,
      scrapAgg,
      processedAgg,
      lastLog,
      lastScrap,
      statusGroups,
      dailyLogs,
      stationGroup,
      selectedProject,
    ] = await Promise.all([
      this.prisma.projectOrder.count(),
      this.prisma.projectOrder.count({
        where: { status: OrderStatus.IN_PROGRESS },
      }),
      this.prisma.stationLog.count({ where: logWhere }),
      this.prisma.scrapReport.aggregate({
        where: scrapWhere,
        _sum: { scrapQty: true },
      }),
      this.prisma.stationLog.aggregate({
        where: logWhere,
        _sum: { processedQty: true },
      }),
      this.prisma.stationLog.aggregate({
        where: logWhere,
        _max: { createdAt: true },
      }),
      this.prisma.scrapReport.aggregate({
        where: scrapWhere,
        _max: { createdAt: true },
      }),
      this.prisma.projectOrder.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.stationLog.findMany({
        where: {
          ...logWhere,
          createdAt: { gte: windowStart },
        },
        select: { createdAt: true, processedQty: true },
      }),
      this.prisma.stationLog.groupBy({
        by: ['stationId'],
        where: logWhere,
        _sum: { processedQty: true },
      }),
      scopeId
        ? this.prisma.projectOrder.findUnique({
            where: { id: scopeId },
            select: {
              id: true,
              name: true,
              lineMaterial: true,
              machiningRoute: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const [projectStationTotals, ordersList, site7LogsDesc] = await Promise.all([
      this.prisma.stationLog.groupBy({
        by: ['projectId', 'stationId'],
        _sum: { processedQty: true },
      }),
      this.prisma.projectOrder.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 200,
        include: {
          documents: { orderBy: { sortOrder: 'asc' } },
          createdBy: { select: openedByUserSelect },
          planningSawsManager: { select: openedByUserSelect },
          planningAssignee: { select: openedByUserSelect },
        },
      }),
      this.prisma.stationLog.findMany({
        where: { stationId: 7 },
        orderBy: { createdAt: 'desc' },
        select: { projectId: true, extraPayload: true },
      }),
    ]);

    const latestSite7ByProject = new Map<
      string,
      { extraPayload: unknown }
    >();
    for (const log of site7LogsDesc) {
      if (!latestSite7ByProject.has(log.projectId)) {
        latestSite7ByProject.set(log.projectId, log);
      }
    }

    const qtyByProjectStation = new Map<string, Map<number, number>>();
    for (const row of projectStationTotals) {
      let m = qtyByProjectStation.get(row.projectId);
      if (!m) {
        m = new Map();
        qtyByProjectStation.set(row.projectId, m);
      }
      m.set(row.stationId, row._sum.processedQty ?? 0);
    }

    const processedVol = processedAgg._sum.processedQty ?? 0;
    const scrapVol = scrapAgg._sum.scrapQty ?? 0;
    const scrapRatePct =
      processedVol + scrapVol > 0
        ? Math.round((scrapVol / (processedVol + scrapVol)) * 1000) / 10
        : null;

    const lastActivityAt = pickMaxDate(
      lastLog._max.createdAt,
      lastScrap._max.createdAt,
    );

    const byDay = new Map<string, number>();
    for (const l of dailyLogs) {
      const k = utcDayKey(l.createdAt);
      byDay.set(k, (byDay.get(k) ?? 0) + l.processedQty);
    }

    const dailyLabels: string[] = [];
    const dailyUnits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(windowStart);
      d.setUTCDate(windowStart.getUTCDate() + i);
      const key = utcDayKey(d);
      dailyLabels.push(key);
      dailyUnits.push(byDay.get(key) ?? 0);
    }

    const variantOrder = selectedProject
      ? {
          lineMaterial: selectedProject.lineMaterial,
          machiningRoute: selectedProject.machiningRoute,
        }
      : null;
    const stationLabels = STATION_ORDER.map((id) =>
      resolveStationDisplayNameHe(id, variantOrder),
    );
    const stationData = STATION_ORDER.map((id) => {
      const g = stationGroup.find((x) => x.stationId === id);
      return g?._sum.processedQty ?? 0;
    });

    const maxStation = Math.max(...stationData, 1);
    const stationColors = stationData.map((v) => {
      const ratio = v / maxStation;
      if (ratio >= 0.85) return 'rgba(239, 68, 68, 0.75)';
      if (ratio >= 0.6) return 'rgba(249, 115, 22, 0.72)';
      if (ratio >= 0.4) return 'rgba(234, 179, 8, 0.7)';
      if (ratio >= 0.2) return 'rgba(34, 197, 94, 0.68)';
      return 'rgba(59, 130, 246, 0.65)';
    });

    const bottlenecks = await this.computeBottlenecks(scopeId);

    const statusLabels = statusGroups.map((g) => g.status);
    const statusData = statusGroups.map((g) => g._count._all);
    const statusColors = statusLabels.map((s) => this.statusColor(s));

    const charts: Record<string, unknown> = {
      dailyProgress: {
        labels: dailyLabels,
        datasets: [
          {
            label: 'יחידות מעובדות',
            data: dailyUnits,
            borderColor: 'rgba(14, 165, 233, 1)',
            backgroundColor: 'rgba(14, 165, 233, 0.25)',
          },
        ],
      },
      stationLoad: {
        labels: stationLabels,
        datasets: [
          {
            label: 'יחידות מעובדות (מצטבר)',
            data: stationData,
            backgroundColor: stationColors,
          },
        ],
      },
    };

    if (!scopeId && statusLabels.length > 0) {
      charts['statusMix'] = {
        labels: statusLabels,
        datasets: [
          {
            data: statusData,
            backgroundColor: statusColors,
            borderWidth: 2,
            borderColor: 'rgba(15, 23, 42, 0.35)',
          },
        ],
      };
    }

    return {
      summary: {
        totalOrders: orders,
        activeOrders,
        stationLogEntries: logCount,
        scrapUnits: scrapVol,
        processedVolume: processedVol,
        scrapRatePct,
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
        scope: scopeId ? 'project' : 'all',
      },
      selectedProject,
      projects: ordersList.map((o) => {
        const workOrders = o.documents
          .filter((d) => d.kind === 'WORK_ORDER')
          .map((d) => ({
            id: d.id,
            kind: d.kind,
            title: d.title,
            reference: d.reference,
            pdfUrl: d.pdfPath,
            createdAt: d.createdAt.toISOString(),
          }));
        const purchaseOrders = o.documents
          .filter((d) => d.kind === 'PURCHASE_ORDER')
          .map((d) => ({
            id: d.id,
            kind: d.kind,
            title: d.title,
            reference: d.reference,
            pdfUrl: d.pdfPath,
            createdAt: d.createdAt.toISOString(),
          }));
        const qtyMap = qtyByProjectStation.get(o.id);
        const qtyAt = (sid: number) => qtyMap?.get(sid) ?? 0;
        const packed = qtyAt(6);
        const liveViewAvailable =
          o.flowStatus === ProjectFlowStatus.IN_PRODUCTION &&
          o.status === OrderStatus.IN_PROGRESS &&
          qtyAt(1) >= 1;
        const site7Log = latestSite7ByProject.get(o.id);
        const stationSevenPct = siteLinePercentFromOrderRow(
          o.siteDeliveryNotePath,
          {
            beams: o.siteExpectedBeams ?? 0,
            glazing: o.siteExpectedGlazing ?? 0,
            unitized: o.siteExpectedUnitized ?? 0,
          },
          site7Log?.extraPayload,
        );
        return {
          id: o.id,
          name: o.name,
          status: o.status,
          flowStatus: o.flowStatus,
          lineMaterial: o.lineMaterial,
          machiningRoute: o.machiningRoute,
          totalItems: o.totalItems,
          packed,
          progressPct: averageOverallLinePercent(
            o.totalItems,
            qtyAt,
            stationSevenPct,
          ),
          workOrders,
          purchaseOrders,
          liveViewAvailable,
          openedBy: mapOpenedBy(
            o.createdBy,
            o.planningSawsManager,
            o.planningAssignee,
          ),
        };
      }),
      bottlenecks,
      charts,
    };
  }

  private statusColor(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.IN_PROGRESS:
        return 'rgba(34, 197, 94, 0.85)';
      case OrderStatus.COMPLETED:
        return 'rgba(59, 130, 246, 0.85)';
      case OrderStatus.ON_HOLD:
        return 'rgba(234, 179, 8, 0.85)';
      default:
        return 'rgba(148, 163, 184, 0.85)';
    }
  }

  private async computeBottlenecks(
    scopeId?: string,
  ): Promise<
    { stationId: number; name: string; severity: number; detail: string }[]
  > {
    const variantOrder = scopeId
      ? await this.prisma.projectOrder.findUnique({
          where: { id: scopeId },
          select: { lineMaterial: true, machiningRoute: true },
        })
      : null;

    const logs = await this.prisma.stationLog.groupBy({
      by: ['stationId'],
      where: scopeId ? { projectId: scopeId } : {},
      _sum: { processedQty: true },
      _count: { _all: true },
    });

    const scored = logs.map((l) => {
      const processed = l._sum.processedQty ?? 0;
      const visits = l._count._all;
      const severity =
        visits > 0 ? Math.max(0, 100 - processed / (visits * 4)) : 50;
      return {
        stationId: l.stationId,
        name:
          resolveStationDisplayNameHe(l.stationId, variantOrder) ??
          `עמדה ${l.stationId}`,
        severity: Math.round(severity),
        detail:
          processed === 0
            ? 'אין דיווח ייצור לאחרונה'
            : `סה״כ יחידות בעמדה: ${processed}`,
      };
    });

    return scored.sort((a, b) => b.severity - a.severity).slice(0, 3);
  }

  async getScrapOverview(projectId?: string) {
    const where = projectId?.trim()
      ? { projectId: projectId.trim() }
      : {};
    const rows = await this.prisma.scrapReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 800,
      include: {
        project: {
          select: { name: true, lineMaterial: true, machiningRoute: true },
        },
      },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: r.project.name,
        stationId: r.stationId,
        stationName: resolveStationDisplayNameHe(r.stationId, r.project),
        itemLengthMm: Number(r.itemLength),
        scrapQty: r.scrapQty,
        profileKind: r.profileKind,
        profileCode: r.profileCode,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Profile scrap inventory + project list for order simulation. */
  async getSimulationSnapshot() {
    const projects = await this.prisma.projectOrder.findMany({
      select: {
        id: true,
        name: true,
        originalLength: true,
        totalItems: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const scraps = await this.prisma.scrapReport.findMany({
      select: {
        projectId: true,
        itemLength: true,
        scrapQty: true,
        profileKind: true,
        profileCode: true,
      },
    });
    const scrapMmByProject = new Map<string, number>();
    const inventoryByProject = new Map<string, ReturnType<typeof aggregateScrapReports>>();

    for (const p of projects) {
      inventoryByProject.set(p.id, []);
    }

    const scrapsByProject = new Map<string, typeof scraps>();
    for (const s of scraps) {
      const mm = Number(s.itemLength) * s.scrapQty;
      scrapMmByProject.set(
        s.projectId,
        (scrapMmByProject.get(s.projectId) ?? 0) + mm,
      );
      const arr = scrapsByProject.get(s.projectId) ?? [];
      arr.push(s);
      scrapsByProject.set(s.projectId, arr);
    }

    for (const [projectId, rows] of scrapsByProject) {
      inventoryByProject.set(projectId, aggregateScrapReports(rows));
    }

    return {
      catalogProfileCodes: [...CATALOG_PROFILE_CODES],
      projects: projects.map((p) => {
        const needMm = Number(p.originalLength) * p.totalItems;
        const scrapMm = scrapMmByProject.get(p.id) ?? 0;
        return {
          projectId: p.id,
          name: p.name,
          needMm,
          scrapMm,
          gapMm: Math.max(0, needMm - scrapMm),
          originalLengthMm: Number(p.originalLength),
          totalItems: p.totalItems,
          profileInventory: inventoryByProject.get(p.id) ?? [],
        };
      }),
    };
  }

  /** פירוט דיווחים ופחת לפרויקט — מודאל ניהול */
  async getProjectActivity(projectId: string) {
    const id = projectId?.trim();
    if (!id) {
      throw new NotFoundException('project not found');
    }

    const project = await this.prisma.projectOrder.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        flowStatus: true,
        totalItems: true,
        updatedAt: true,
        createdAt: true,
        lineMaterial: true,
        machiningRoute: true,
        _count: { select: { documents: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('project not found');
    }

    const variantOrder = {
      lineMaterial: project.lineMaterial,
      machiningRoute: project.machiningRoute,
    };

    const [logGroups, scrapGroups, recentLogs, scrapRows, stationLogEntries] =
      await Promise.all([
      this.prisma.stationLog.groupBy({
        by: ['stationId'],
        where: { projectId: id },
        _sum: { processedQty: true },
        _count: { _all: true },
        _max: { createdAt: true },
        _min: { createdAt: true },
      }),
      this.prisma.scrapReport.groupBy({
        by: ['stationId'],
        where: { projectId: id },
        _sum: { scrapQty: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.stationLog.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
        take: 45,
        select: {
          id: true,
          stationId: true,
          processedQty: true,
          createdAt: true,
          issues: true,
        },
      }),
      this.prisma.scrapReport.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: {
          id: true,
          stationId: true,
          scrapQty: true,
          itemLength: true,
          createdAt: true,
        },
      }),
      this.prisma.stationLog.count({ where: { projectId: id } }),
    ]);

    const totalProcessed = logGroups.reduce(
      (a, g) => a + (g._sum.processedQty ?? 0),
      0,
    );
    const totalScrapUnits = scrapGroups.reduce(
      (a, g) => a + (g._sum.scrapQty ?? 0),
      0,
    );

    const stations = STATION_ORDER.map((sid) => {
      const lg = logGroups.find((x) => x.stationId === sid);
      const sg = scrapGroups.find((x) => x.stationId === sid);
      return {
        stationId: sid,
        stationName: resolveStationDisplayNameHe(sid, variantOrder),
        logEntries: lg?._count._all ?? 0,
        processedQty: lg?._sum.processedQty ?? 0,
        firstEntryAt: lg?._min.createdAt?.toISOString() ?? null,
        lastEntryAt: lg?._max.createdAt?.toISOString() ?? null,
        scrapQty: sg?._sum.scrapQty ?? 0,
        scrapEntries: sg?._count._all ?? 0,
        lastScrapAt: sg?._max.createdAt?.toISOString() ?? null,
      };
    });

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        flowStatus: project.flowStatus,
        totalItems: project.totalItems,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        documentCount: project._count.documents,
      },
      totals: {
        processedQty: totalProcessed,
        scrapUnits: totalScrapUnits,
        stationLogEntries,
      },
      stations,
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        stationId: l.stationId,
        processedQty: l.processedQty,
        createdAt: l.createdAt.toISOString(),
        issues: l.issues,
      })),
      scrapRows: scrapRows.map((r) => ({
        id: r.id,
        stationId: r.stationId,
        stationName: resolveStationDisplayNameHe(r.stationId, variantOrder),
        scrapQty: r.scrapQty,
        itemLengthMm: Number(r.itemLength),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
