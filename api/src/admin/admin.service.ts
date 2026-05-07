import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  averageOverallLinePercent,
  siteLinePercentFromOrderRow,
} from './line-progress.util';

const STATION_NAMES: Record<number, string> = {
  1: 'מסורים',
  2: 'CNC',
  3: 'הרכבה',
  4: 'הדבקות',
  5: 'פינישים',
  6: 'אריזה',
  7: 'הרכבה באתר',
};

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
            select: { id: true, name: true },
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
        take: 50,
        include: {
          documents: { orderBy: { sortOrder: 'asc' } },
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

    const stationLabels = STATION_ORDER.map((id) => STATION_NAMES[id]);
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
          }));
        const purchaseOrders = o.documents
          .filter((d) => d.kind === 'PURCHASE_ORDER')
          .map((d) => ({
            id: d.id,
            kind: d.kind,
            title: d.title,
            reference: d.reference,
            pdfUrl: d.pdfPath,
          }));
        const qtyMap = qtyByProjectStation.get(o.id);
        const qtyAt = (sid: number) => qtyMap?.get(sid) ?? 0;
        const packed = qtyAt(6);
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
          totalItems: o.totalItems,
          packed,
          progressPct: averageOverallLinePercent(
            o.totalItems,
            qtyAt,
            stationSevenPct,
          ),
          workOrders,
          purchaseOrders,
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
        name: STATION_NAMES[l.stationId] ?? `עמדה ${l.stationId}`,
        severity: Math.round(severity),
        detail:
          processed === 0
            ? 'אין דיווח ייצור לאחרונה'
            : `סה״כ יחידות בעמדה: ${processed}`,
      };
    });

    return scored.sort((a, b) => b.severity - a.severity).slice(0, 3);
  }
}
