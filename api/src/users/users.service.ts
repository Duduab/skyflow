import { Injectable, NotFoundException } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import type { UserPerformanceResponse } from './user-performance.types.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
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
