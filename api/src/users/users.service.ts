import { Injectable, NotFoundException } from '@nestjs/common';
import { DailyTargetSource, NotificationKind, SkyflowRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveStationDisplayNameHe } from '../common/station-presentation.util.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { CreateUserDailyTargetDto } from './dto/create-user-daily-target.dto.js';
import { manualDailyTargetDedupeKey } from './daily-target-planning.util.js';
import { DailyTargetPlanningService } from './daily-target-planning.service.js';
import type { UserPerformanceResponse } from './user-performance.types.js';
import type {
  UserDailyTargetDayRow,
  UserDailyTargetItemRow,
  UserDailyTargetLineItemRow,
  UserDailyTargetsResponse,
} from './user-daily-target.types.js';
import type {
  UserDailyTargetAlertLevel,
  UserDailyTargetAlertRow,
  UserDailyTargetAlertsResponse,
} from './user-daily-target-alert.types.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly dailyTargetPlanning: DailyTargetPlanningService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll() {
    const rows = await this.prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    });
    return rows.map((u) => this.auth.toPublic(u));
  }

  /** Station / site managers for worker hub cards (one per station if assigned). */
  async stationManagers() {
    const rows = await this.prisma.user.findMany({
      where: {
        role: {
          in: [SkyflowRole.STATION_MANAGER, SkyflowRole.SITE_MANAGER],
        },
        managedStationId: { not: null },
      },
      select: {
        managedStationId: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
      },
    });
    const byStation: Record<
      number,
      { firstName: string; lastName: string; photoUrl: string | null }
    > = {};
    for (const r of rows) {
      const sid = r.managedStationId!;
      byStation[sid] = {
        firstName: r.firstName,
        lastName: r.lastName,
        photoUrl: r.photoUrl,
      };
    }
    return byStation;
  }

  /** Workers + station-1 managers for תפ״י assignment step */
  async planningAssignees() {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { role: SkyflowRole.WORKER },
          {
            role: SkyflowRole.STATION_MANAGER,
            managedStationId: 1,
          },
        ],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        managedStationId: true,
        photoUrl: true,
      },
    });
  }

  /** מנהלי אתר/פרויקט — לבחירת מנהל פרויקט בשלב פתיחת הפרויקט */
  async siteManagers() {
    return this.prisma.user.findMany({
      where: { role: SkyflowRole.SITE_MANAGER },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        managedStationId: true,
        photoUrl: true,
      },
    });
  }

  async create(dto: CreateUserDto) {
    const hash = await bcrypt.hash(dto.password, 10);
    const stationBound =
      dto.role === SkyflowRole.STATION_MANAGER ||
      dto.role === SkyflowRole.SITE_MANAGER;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        passwordHash: hash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        photoUrl: dto.photoUrl ?? null,
        managedStationId: stationBound ? dto.managedStationId ?? null : null,
      },
    });
    return this.auth.toPublic(user);
  }

  async getPerformance(userId: string): Promise<UserPerformanceResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const logs = await this.prisma.stationLog.findMany({
      where: { workerId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        stationId: true,
        processedQty: true,
        issues: true,
        createdAt: true,
        project: { select: { name: true } },
      },
    });

    const now = new Date();
    const todayKey = this.localDateKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = this.localDateKey(yesterday);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    let totalProcessedQty = 0;
    let todayReports = 0;
    let yesterdayReports = 0;
    let todayProcessedQty = 0;
    let yesterdayProcessedQty = 0;
    let weeklyReports = 0;

    const projectIds = new Set<string>();
    const byStationMap = new Map<
      number,
      { reports: number; processedQty: number }
    >();
    const byDayMap = new Map<
      string,
      { reports: number; processedQty: number; times: number[] }
    >();

    for (const log of logs) {
      totalProcessedQty += log.processedQty;
      projectIds.add(log.projectId);

      const dayKey = this.localDateKey(log.createdAt);
      const day = byDayMap.get(dayKey) ?? {
        reports: 0,
        processedQty: 0,
        times: [],
      };
      day.reports += 1;
      day.processedQty += log.processedQty;
      day.times.push(log.createdAt.getTime());
      byDayMap.set(dayKey, day);

      const st = byStationMap.get(log.stationId) ?? {
        reports: 0,
        processedQty: 0,
      };
      st.reports += 1;
      st.processedQty += log.processedQty;
      byStationMap.set(log.stationId, st);

      if (dayKey === todayKey) {
        todayReports += 1;
        todayProcessedQty += log.processedQty;
      } else if (dayKey === yesterdayKey) {
        yesterdayReports += 1;
        yesterdayProcessedQty += log.processedQty;
      }
      if (log.createdAt >= weekAgo) weeklyReports += 1;
    }

    const activeDays = byDayMap.size;
    let estimatedActiveHours = 0;
    const dailyActivity = Array.from(byDayMap.entries())
      .map(([date, d]) => {
        const hours = this.estimateDayHours(d.times);
        estimatedActiveHours += hours;
        return {
          date,
          reports: d.reports,
          processedQty: d.processedQty,
          estimatedHours: hours,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-21);

    const plantWeekly = await this.plantWeeklyReportCount(weekAgo);
    const workerCount = await this.prisma.user.count({
      where: { role: { in: [SkyflowRole.WORKER, SkyflowRole.STATION_MANAGER] } },
    });
    const plantAvgWeekly =
      workerCount > 0 ? plantWeekly / workerCount : null;
    const paceVsPlantPct =
      plantAvgWeekly != null && plantAvgWeekly > 0
        ? Math.round((weeklyReports / plantAvgWeekly) * 1000) / 10
        : weeklyReports > 0
          ? 100
          : null;

    const byStation = Array.from(byStationMap.entries())
      .map(([stationId, v]) => ({
        stationId,
        reports: v.reports,
        processedQty: v.processedQty,
      }))
      .sort((a, b) => a.stationId - b.stationId);

    const recentActivity = logs.slice(0, 25).map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      stationId: log.stationId,
      projectId: log.projectId,
      projectName: log.project.name,
      processedQty: log.processedQty,
      issues: log.issues?.trim() || null,
    }));

    const first = logs.length ? logs[logs.length - 1]!.createdAt : null;
    const last = logs.length ? logs[0]!.createdAt : null;

    return {
      user: this.auth.toPublic(user),
      summary: {
        totalReports: logs.length,
        totalProcessedQty,
        projectsTouched: projectIds.size,
        activeDays,
        estimatedActiveHours: Math.round(estimatedActiveHours * 10) / 10,
        todayReports,
        yesterdayReports,
        todayProcessedQty,
        yesterdayProcessedQty,
        avgReportsPerActiveDay:
          activeDays > 0
            ? Math.round((logs.length / activeDays) * 10) / 10
            : 0,
        weeklyReports,
        paceVsPlantPct,
        lastActivityAt: last?.toISOString() ?? null,
        firstActivityAt: first?.toISOString() ?? null,
      },
      byStation,
      dailyActivity,
      recentActivity,
    };
  }

  async getDailyTargets(userId: string): Promise<UserDailyTargetsResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const todayKey = this.localDateKey(new Date());
    const [targets, logs] = await Promise.all([
      this.prisma.userDailyTarget.findMany({
        where: { userId },
        include: {
          project: {
            select: {
              name: true,
              lineMaterial: true,
              machiningRoute: true,
            },
          },
        },
        orderBy: [{ targetDate: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.stationLog.findMany({
        where: { workerId: userId },
        select: {
          processedQty: true,
          createdAt: true,
          projectId: true,
          stationId: true,
          extraPayload: true,
        },
      }),
    ]);

    const byDayMap = this.buildDayActivityMap(logs);
    const enrichedTargets = await Promise.all(
      targets.map(async (t) => ({
        ...t,
        resolvedLineItems:
          t.source === DailyTargetSource.PLANNING &&
          t.projectId != null &&
          t.stationId != null
            ? await this.dailyTargetPlanning.resolveLineItemsForTarget(
                userId,
                t.projectId,
                t.stationId,
                t.lineItems,
              )
            : [],
      })),
    );

    const targetsByDate = new Map<string, typeof enrichedTargets>();
    for (const t of enrichedTargets) {
      const list = targetsByDate.get(t.targetDate) ?? [];
      list.push(t);
      targetsByDate.set(t.targetDate, list);
    }

    const dateKeys = new Set<string>([
      ...enrichedTargets.map((t) => t.targetDate),
      ...byDayMap.keys(),
    ]);

    const history: UserDailyTargetDayRow[] = Array.from(dateKeys)
      .map((date) =>
        this.buildDailyTargetDayRow(
          date,
          targetsByDate.get(date) ?? [],
          byDayMap.get(date),
          logs,
        ),
      )
      .sort((a, b) => b.date.localeCompare(a.date));

    const todayRow =
      targetsByDate.has(todayKey) || byDayMap.has(todayKey)
        ? this.buildDailyTargetDayRow(
            todayKey,
            targetsByDate.get(todayKey) ?? [],
            byDayMap.get(todayKey),
            logs,
          )
        : null;

    return {
      user: this.auth.toPublic(user),
      todayKey,
      today: todayRow,
      history,
    };
  }

  async upsertDailyTarget(
    userId: string,
    dto: CreateUserDailyTargetDto,
    actorUserId?: string | null,
  ): Promise<UserDailyTargetsResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const targetDate =
      dto.targetDate?.trim() || this.localDateKey(new Date());
    const description = dto.description.trim();
    const dedupeKey = manualDailyTargetDedupeKey(userId, targetDate);

    await this.prisma.userDailyTarget.upsert({
      where: { dedupeKey },
      create: {
        userId,
        targetDate,
        source: DailyTargetSource.MANUAL,
        description,
        targetMinutes: dto.targetMinutes,
        dedupeKey,
      },
      update: {
        description,
        targetMinutes: dto.targetMinutes,
      },
    });

    await this.notifications.emit({
      kind: NotificationKind.DAILY_TARGET_MANUAL,
      titleKey: 'NOTIFICATIONS.DAILY_TARGET_MANUAL_TITLE',
      bodyKey: 'NOTIFICATIONS.DAILY_TARGET_MANUAL_BODY',
      params: {
        worker: `${user.firstName} ${user.lastName}`.trim(),
        description,
        date: targetDate,
      },
      link: '/admin/users',
      actorUserId,
    });

    return this.getDailyTargets(userId);
  }

  async getTodayTargetAlerts(): Promise<UserDailyTargetAlertsResponse> {
    const now = new Date();
    const todayKey = this.localDateKey(now);
    const hour = now.getHours();

    const targets = await this.prisma.userDailyTarget.findMany({
      where: { targetDate: todayKey },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
        project: {
          select: {
            name: true,
            lineMaterial: true,
            machiningRoute: true,
          },
        },
      },
    });

    if (!targets.length) {
      return { todayKey, alerts: [] };
    }

    const userIds = [...new Set(targets.map((t) => t.userId))];
    const logs = await this.prisma.stationLog.findMany({
      where: { workerId: { in: userIds } },
      select: {
        workerId: true,
        processedQty: true,
        createdAt: true,
        projectId: true,
        stationId: true,
        extraPayload: true,
      },
    });

    const logsByUser = new Map<string, typeof logs>();
    for (const log of logs) {
      if (!log.workerId) continue;
      const list = logsByUser.get(log.workerId) ?? [];
      list.push(log);
      logsByUser.set(log.workerId, list);
    }

    const targetsByUser = new Map<string, typeof targets>();
    for (const t of targets) {
      const list = targetsByUser.get(t.userId) ?? [];
      list.push(t);
      targetsByUser.set(t.userId, list);
    }

    const alerts: UserDailyTargetAlertRow[] = [];
    for (const userId of userIds) {
      const userTargets = targetsByUser.get(userId) ?? [];
      const userLogs = logsByUser.get(userId) ?? [];
      const user = userTargets[0]?.user;
      if (!user) continue;

      const dayRow = this.buildDailyTargetDayRow(
        todayKey,
        userTargets.map((t) => ({ ...t, resolvedLineItems: [] })),
        this.buildDayActivityMap(userLogs).get(todayKey),
        userLogs,
      );
      if (dayRow.achievementPct == null || dayRow.achievementPct >= 100) {
        continue;
      }

      const level = this.resolveTodayAlertLevel(dayRow.achievementPct, hour);
      if (!level) continue;

      alerts.push({
        userId,
        firstName: user.firstName,
        lastName: user.lastName,
        description: dayRow.description ?? dayRow.items[0]?.description ?? '',
        targetMinutes: dayRow.targetMinutes ?? 0,
        actualMinutes: dayRow.actualMinutes,
        achievementPct: dayRow.achievementPct,
        level,
      });
    }

    alerts.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level === 'missed' ? -1 : 1;
      }
      return a.achievementPct - b.achievementPct;
    });

    return { todayKey, alerts };
  }

  private resolveTodayAlertLevel(
    achievementPct: number,
    hour: number,
  ): UserDailyTargetAlertLevel | null {
    if (achievementPct >= 100) return null;
    if (achievementPct < 80) return 'warning';
    if (hour >= 16) return 'missed';
    return null;
  }

  private buildDayActivityMap(
    logs: { processedQty: number; createdAt: Date }[],
  ): Map<string, { reports: number; processedQty: number; times: number[] }> {
    const byDayMap = new Map<
      string,
      { reports: number; processedQty: number; times: number[] }
    >();
    for (const log of logs) {
      const dayKey = this.localDateKey(log.createdAt);
      const day = byDayMap.get(dayKey) ?? {
        reports: 0,
        processedQty: 0,
        times: [],
      };
      day.reports += 1;
      day.processedQty += log.processedQty;
      day.times.push(log.createdAt.getTime());
      byDayMap.set(dayKey, day);
    }
    return byDayMap;
  }

  private actualQtyForPlanningTarget(
    date: string,
    projectId: string,
    stationId: number,
    logs: {
      processedQty: number;
      createdAt: Date;
      projectId: string;
      stationId: number;
      extraPayload?: unknown;
    }[],
  ): number {
    const dayLogs = logs.filter(
      (log) =>
        this.localDateKey(log.createdAt) === date &&
        log.projectId === projectId &&
        log.stationId === stationId,
    );

    if (stationId === 1) {
      const linePeak = new Map<string, number>();
      let simpleQty = 0;
      for (const log of dayLogs) {
        simpleQty += log.processedQty;
        const ep = log.extraPayload as Record<string, unknown> | null;
        if (!ep?.['sawModalSnapshot'] || !ep['sawLineSawnById']) continue;
        const bag = ep['sawLineSawnById'] as Record<string, unknown>;
        for (const [lineId, v] of Object.entries(bag)) {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) continue;
          const qty = Math.floor(n);
          linePeak.set(lineId, Math.max(linePeak.get(lineId) ?? 0, qty));
        }
      }
      const sawQty = [...linePeak.values()].reduce((s, n) => s + n, 0);
      return sawQty > 0 ? sawQty : simpleQty;
    }

    return dayLogs.reduce((sum, log) => sum + log.processedQty, 0);
  }

  private buildDailyTargetDayRow(
    date: string,
    dayTargets: {
      id: string;
      source: DailyTargetSource;
      description: string;
      targetMinutes: number;
      targetQty: number | null;
      projectId: string | null;
      stationId: number | null;
      resolvedLineItems: UserDailyTargetLineItemRow[];
      project: {
        name: string;
        lineMaterial: 'ALUMINUM' | 'STEEL';
        machiningRoute: 'GLASS' | 'ALU_RANGER';
      } | null;
    }[],
    activity:
      | { reports: number; processedQty: number; times: number[] }
      | undefined,
    logs: {
      processedQty: number;
      createdAt: Date;
      projectId: string;
      stationId: number;
      extraPayload?: unknown;
    }[],
  ): UserDailyTargetDayRow {
    const actualMinutes = Math.round(
      this.estimateDayHours(activity?.times ?? []) * 60,
    );

    const items: UserDailyTargetItemRow[] = dayTargets.map((target) => {
      const isPlanning =
        target.source === DailyTargetSource.PLANNING &&
        target.targetQty != null &&
        target.projectId != null &&
        target.stationId != null;

      if (isPlanning) {
        const actualQty = this.actualQtyForPlanningTarget(
          date,
          target.projectId!,
          target.stationId!,
          logs,
        );
        const achievementPct =
          target.targetQty! > 0
            ? Math.min(
                999,
                Math.round((actualQty / target.targetQty!) * 1000) / 10,
              )
            : null;
        return {
          id: target.id,
          source: 'PLANNING',
          description: target.description,
          targetMinutes: target.targetMinutes,
          targetQty: target.targetQty,
          actualQty,
          achievementPct,
          projectId: target.projectId,
          projectName: target.project?.name ?? null,
          stationId: target.stationId,
          stationName: resolveStationDisplayNameHe(target.stationId!, {
            lineMaterial: target.project?.lineMaterial,
            machiningRoute: target.project?.machiningRoute,
          }),
          lineItems: target.resolvedLineItems,
        };
      }

      const achievementPct =
        target.targetMinutes > 0
          ? Math.min(
              999,
              Math.round((actualMinutes / target.targetMinutes) * 1000) / 10,
            )
          : null;

      return {
        id: target.id,
        source: 'MANUAL',
        description: target.description,
        targetMinutes: target.targetMinutes,
        targetQty: null,
        actualQty: activity?.processedQty ?? 0,
        achievementPct,
        projectId: null,
        projectName: null,
        stationId: null,
        stationName: null,
        lineItems: [],
      };
    });

    const qtyItems = items.filter((i) => i.targetQty != null && i.targetQty > 0);
    const totalTargetQty = qtyItems.reduce(
      (s, i) => s + (i.targetQty ?? 0),
      0,
    );
    const totalActualQty = qtyItems.reduce((s, i) => s + i.actualQty, 0);
    const totalTargetMinutes = items.reduce((s, i) => s + i.targetMinutes, 0);

    let achievementPct: number | null = null;
    if (totalTargetQty > 0) {
      achievementPct = Math.min(
        999,
        Math.round((totalActualQty / totalTargetQty) * 1000) / 10,
      );
    } else if (totalTargetMinutes > 0) {
      achievementPct = Math.min(
        999,
        Math.round((actualMinutes / totalTargetMinutes) * 1000) / 10,
      );
    }

    const description =
      items.length === 1
        ? items[0]!.description
        : items.length > 1
          ? items
              .map((i) => i.projectName ?? i.description)
              .filter(Boolean)
              .join(' · ')
          : null;

    return {
      date,
      description,
      targetMinutes: totalTargetMinutes > 0 ? totalTargetMinutes : null,
      targetQty: totalTargetQty > 0 ? totalTargetQty : null,
      actualMinutes,
      actualQty: totalActualQty > 0 ? totalActualQty : activity?.processedQty ?? 0,
      achievementPct,
      reports: activity?.reports ?? 0,
      processedQty: activity?.processedQty ?? 0,
      hasTarget: items.length > 0,
      items,
    };
  }

  private localDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private estimateDayHours(times: number[]): number {
    if (!times.length) return 0;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const spanH = (max - min) / 3_600_000;
    return Math.round(Math.max(0.25, Math.min(spanH + 0.25, 10)) * 10) / 10;
  }

  private async plantWeeklyReportCount(since: Date): Promise<number> {
    return this.prisma.stationLog.count({
      where: {
        workerId: { not: null },
        createdAt: { gte: since },
      },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    let passwordHash: string | undefined;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, 10);
    }
    const role = dto.role ?? existing.role;
    const stationBound =
      role === SkyflowRole.STATION_MANAGER ||
      role === SkyflowRole.SITE_MANAGER;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email !== undefined ? dto.email.trim().toLowerCase() : undefined,
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        role: dto.role ?? undefined,
        photoUrl: dto.photoUrl === undefined ? undefined : dto.photoUrl,
        managedStationId: stationBound
          ? dto.managedStationId !== undefined
            ? dto.managedStationId
            : existing.managedStationId
          : null,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    return this.auth.toPublic(user);
  }
}
