import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ElevationCellStatus,
  OrderStatus,
  Prisma,
  ProjectAngleSourcing,
  ProjectFlowStatus,
  WorkCycleStationStatus,
  WorkCycleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Laser is the parallel angle station (mirrors stations.service LASER_STATION_ID). */
const LASER_STATION_ID = 8;

/** Linear line stations every work cycle passes through (1 → 7). */
const LINE_STATIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

@Injectable()
export class WorkCycleService {
  private readonly logger = new Logger(WorkCycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The set of stations a cycle for `windowType` in `project` passes through.
   * Line stations 1–7 always apply; the laser station (8) is added only when the
   * project sources angles internally AND this window actually has angles.
   */
  stationChain(
    project: { angleSourcing: ProjectAngleSourcing },
    windowType: { hasAngles: boolean },
  ): number[] {
    const chain = [...LINE_STATIONS];
    if (
      project.angleSourcing === ProjectAngleSourcing.INTERNAL_LASER &&
      windowType.hasAngles
    ) {
      chain.push(LASER_STATION_ID);
    }
    return chain;
  }

  /**
   * Ensure a DRAFT work cycle exists for a window type known from the quantities
   * file (before its production instructions are uploaded). Keeps targetQty in
   * sync but never downgrades a cycle that has already been opened.
   */
  async ensureDraftCycle(
    projectId: string,
    windowTypeId: string,
    targetQty: number,
  ): Promise<void> {
    await this.prisma.workCycle.upsert({
      where: { windowTypeId },
      update: { targetQty },
      create: {
        projectId,
        windowTypeId,
        status: WorkCycleStatus.DRAFT,
        targetQty,
      },
    });
  }

  /**
   * Sync target qty and station progress rows for a window type without changing
   * an already-open cycle's status. Called when production instructions upload.
   */
  async syncCycleStations(
    projectId: string,
    windowTypeId: string,
  ): Promise<void> {
    const windowType = await this.prisma.windowType.findFirst({
      where: { id: windowTypeId, projectId },
      select: { id: true, totalQty: true, hasAngles: true },
    });
    if (!windowType) throw new NotFoundException('Window type not found');

    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true, angleSourcing: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const targetQty = windowType.totalQty ?? 0;
    const stations = this.stationChain(project, windowType);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workCycle.findUnique({
        where: { windowTypeId },
        select: { id: true },
      });

      const cycle = existing
        ? await tx.workCycle.update({
            where: { windowTypeId },
            data: { targetQty },
            select: { id: true },
          })
        : await tx.workCycle.create({
            data: {
              projectId,
              windowTypeId,
              status: WorkCycleStatus.DRAFT,
              targetQty,
            },
            select: { id: true },
          });

      for (const stationId of stations) {
        await tx.workCycleStationProgress.upsert({
          where: {
            workCycleId_stationId: { workCycleId: cycle.id, stationId },
          },
          update: { targetQty },
          create: {
            workCycleId: cycle.id,
            stationId,
            targetQty,
            status: WorkCycleStationStatus.PENDING,
          },
        });
      }
    });

    this.logger.log(
      `Synced stations for windowType=${windowTypeId} (qty=${targetQty}, stations=[${stations.join(',')}])`,
    );
  }

  /**
   * Open (or refresh) the work cycle for a window type once its production
   * instructions are uploaded. One cycle per window type, qty N from the
   * quantities file. Idempotent: safe to call again on re-upload.
   */
  async openCycleForWindowType(
    projectId: string,
    windowTypeId: string,
  ): Promise<void> {
    const windowType = await this.prisma.windowType.findFirst({
      where: { id: windowTypeId, projectId },
      select: { id: true, totalQty: true, hasAngles: true },
    });
    if (!windowType) throw new NotFoundException('Window type not found');

    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true, angleSourcing: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const stations = this.stationChain(project, windowType);

    await this.syncCycleStations(projectId, windowTypeId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workCycle.findUnique({
        where: { windowTypeId },
        select: { id: true, status: true },
      });
      if (!existing) return;

      if (
        existing.status === WorkCycleStatus.DRAFT ||
        existing.status === WorkCycleStatus.RETURNED
      ) {
        await tx.workCycle.update({
          where: { windowTypeId },
          data: {
            status: WorkCycleStatus.OPEN,
            openedAt: new Date(),
            currentStationId: stations[0] ?? 1,
            returnedAt: null,
            returnedFromStationId: null,
            returnReason: null,
          },
        });
      }
    });

    this.logger.log(`Opened work cycle for windowType=${windowTypeId}`);
  }

  /**
   * Save assignments + optional daily target and release a DRAFT cycle to the floor.
   */
  async launchCycle(
    projectId: string,
    workCycleId: string,
    assignments: {
      userId: string;
      role: 'MANAGER' | 'WORKER';
      stationId?: number | null;
    }[],
    dailyTargetQty: number | null,
  ) {
    const cycle = await this.prisma.workCycle.findFirst({
      where: { id: workCycleId, projectId },
      include: {
        windowType: { select: { id: true, instructionDocId: true } },
      },
    });
    if (!cycle) throw new NotFoundException('Work cycle not found');
    if (cycle.status !== WorkCycleStatus.DRAFT) {
      throw new BadRequestException('Work cycle is already on the production floor');
    }
    if (!cycle.windowType.instructionDocId) {
      throw new BadRequestException(
        'Upload production instructions before launching this unit',
      );
    }

    await this.setAssignments(projectId, workCycleId, assignments);
    await this.setDailyTarget(projectId, workCycleId, dailyTargetQty);
    await this.openCycleForWindowType(projectId, cycle.windowTypeId);
    await this.promoteProjectToProduction(projectId);

    return this.getCycle(projectId, workCycleId);
  }

  /** All work cycles for a project, with window type + progress + assignments. */
  async listByProject(projectId: string) {
    return this.prisma.workCycle.findMany({
      where: { projectId },
      orderBy: { windowType: { sortOrder: 'asc' } },
      include: {
        windowType: {
          select: {
            id: true,
            code: true,
            totalQty: true,
            hasAngles: true,
            instructionDocId: true,
          },
        },
        stationProgress: { orderBy: { stationId: 'asc' } },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  /** Replace the assignments (manager/workers per station) for a work cycle. */
  async setAssignments(
    projectId: string,
    workCycleId: string,
    assignments: {
      userId: string;
      role: 'MANAGER' | 'WORKER';
      stationId?: number | null;
    }[],
  ) {
    const cycle = await this.prisma.workCycle.findFirst({
      where: { id: workCycleId, projectId },
      select: { id: true },
    });
    if (!cycle) throw new NotFoundException('Work cycle not found');

    // De-duplicate on (userId, stationId) to satisfy the unique constraint.
    const seen = new Set<string>();
    const rows = assignments
      .filter((a) => a.userId)
      .filter((a) => {
        const key = `${a.userId}:${a.stationId ?? 'null'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((a, idx) => ({
        workCycleId,
        userId: a.userId,
        role: a.role,
        stationId: a.stationId ?? null,
        sortOrder: idx,
      }));

    await this.prisma.$transaction([
      this.prisma.workCycleAssignment.deleteMany({ where: { workCycleId } }),
      ...(rows.length
        ? [this.prisma.workCycleAssignment.createMany({ data: rows })]
        : []),
    ]);

    return this.getCycle(projectId, workCycleId);
  }

  /** Set (or clear) the manual daily target for a cycle; null keeps auto-calc only. */
  async setDailyTarget(
    projectId: string,
    workCycleId: string,
    dailyTargetQty: number | null,
  ) {
    const cycle = await this.prisma.workCycle.findFirst({
      where: { id: workCycleId, projectId },
      select: { id: true },
    });
    if (!cycle) throw new NotFoundException('Work cycle not found');
    await this.prisma.workCycle.update({
      where: { id: workCycleId },
      data: {
        dailyTargetQty:
          dailyTargetQty == null || dailyTargetQty <= 0 ? null : dailyTargetQty,
      },
    });
    return this.getCycle(projectId, workCycleId);
  }

  /**
   * All units (work cycles) of a project that have production instructions
   * uploaded (OPEN / IN_PROGRESS / RETURNED / COMPLETED), each with its station
   * chain + per-station progress. Drives the unit picker on the worker hub.
   */
  async listForWorker(projectId: string) {
    const cycles = await this.prisma.workCycle.findMany({
      where: {
        projectId,
        status: { not: WorkCycleStatus.DRAFT },
      },
      orderBy: { windowType: { sortOrder: 'asc' } },
      include: {
        windowType: { select: { code: true } },
        stationProgress: { orderBy: { stationId: 'asc' } },
      },
    });
    if (cycles.length) {
      // Compatibility repair for cycles launched before launch updated the
      // project-level flow status. A non-draft cycle means production started.
      await this.promoteProjectToProduction(projectId);
    }
    return cycles.map((c) => ({
      cycleId: c.id,
      windowTypeId: c.windowTypeId,
      code: c.windowType.code,
      status: c.status,
      currentStationId: c.currentStationId,
      targetQty: c.targetQty,
      stations: c.stationProgress.map((sp) => ({
        stationId: sp.stationId,
        targetQty: sp.targetQty,
        processedQty: sp.processedQty,
        remaining: Math.max(0, sp.targetQty - sp.processedQty),
        status: sp.status,
      })),
    }));
  }

  /**
   * Cycles that currently have work waiting at `stationId` (OPEN/IN_PROGRESS,
   * the station is in their chain and not yet done). Drives the worker terminal.
   */
  async cyclesForStation(projectId: string, stationId: number) {
    const cycles = await this.prisma.workCycle.findMany({
      where: {
        projectId,
        status: { in: [WorkCycleStatus.OPEN, WorkCycleStatus.IN_PROGRESS] },
        stationProgress: { some: { stationId } },
      },
      orderBy: { windowType: { sortOrder: 'asc' } },
      include: {
        windowType: {
          select: {
            code: true,
            instructionDoc: { select: { pdfPath: true, title: true } },
          },
        },
        stationProgress: { where: { stationId } },
      },
    });
    return cycles
      .map((c) => {
        const sp = c.stationProgress[0];
        const target = sp?.targetQty ?? c.targetQty;
        const processed = sp?.processedQty ?? 0;
        return {
          cycleId: c.id,
          windowTypeId: c.windowTypeId,
          code: c.windowType.code,
          instructionPdfUrl: c.windowType.instructionDoc?.pdfPath ?? null,
          instructionTitle: c.windowType.instructionDoc?.title ?? null,
          status: c.status,
          currentStationId: c.currentStationId,
          targetQty: target,
          processedQty: processed,
          remaining: Math.max(0, target - processed),
          stationStatus: sp?.status ?? 'PENDING',
        };
      })
      .filter((row) => row.remaining > 0);
  }

  /**
   * Worker reports `qty` completed for a cycle at a station. Increments the
   * per-station progress (capped at target), advances the cycle's current
   * station, and writes an audit StationLog linked to the cycle.
   */
  async reportCycleStationProgress(
    projectId: string,
    workCycleId: string,
    stationId: number,
    qty: number,
    opts?: { workerUserId?: string | null; cutLength?: number | null },
  ) {
    const addQty = Math.floor(qty);
    if (!Number.isFinite(addQty) || addQty <= 0) {
      throw new BadRequestException('qty must be a positive integer');
    }

    const cycle = await this.prisma.workCycle.findFirst({
      where: { id: workCycleId, projectId },
      include: { stationProgress: true },
    });
    if (!cycle) throw new NotFoundException('Work cycle not found');
    if (cycle.status === WorkCycleStatus.DRAFT) {
      throw new BadRequestException(
        'Work cycle has not been launched to the production floor yet',
      );
    }

    // A launched (non-draft) cycle means production has started. Repair the
    // project-level flow status for cycles opened before launch promoted it,
    // so the worker terminal can report even when the hub was never opened.
    await this.promoteProjectToProduction(projectId);
    await this.assertInProduction(projectId);

    const sp = cycle.stationProgress.find((p) => p.stationId === stationId);
    if (!sp) throw new NotFoundException('Station is not part of this cycle');

    const target = sp.targetQty;
    const newProcessed =
      target > 0
        ? Math.min(target, sp.processedQty + addQty)
        : sp.processedQty + addQty;
    const appliedQty = Math.max(1, newProcessed - sp.processedQty);
    const stationDone = target > 0 && newProcessed >= target;

    await this.prisma.$transaction(async (tx) => {
      await tx.workCycleStationProgress.update({
        where: { id: sp.id },
        data: {
          processedQty: newProcessed,
          status: stationDone
            ? WorkCycleStationStatus.DONE
            : WorkCycleStationStatus.IN_PROGRESS,
        },
      });

      await tx.stationLog.create({
        data: {
          projectId,
          stationId,
          processedQty: appliedQty,
          workerId: opts?.workerUserId ?? null,
          workCycleId,
          cutLength: opts?.cutLength ?? null,
        },
      });

      // Recompute the cycle's current station: the first station still open.
      const progresses = await tx.workCycleStationProgress.findMany({
        where: { workCycleId },
        orderBy: { stationId: 'asc' },
      });
      const nextOpen = progresses.find(
        (p) => !(p.targetQty > 0 && p.processedQty >= p.targetQty),
      );
      // Cycle stays IN_PROGRESS even when every station is done — final COMPLETE
      // is confirmed by the project manager on the elevation map (Phase 5).
      await tx.workCycle.update({
        where: { id: workCycleId },
        data: {
          status: WorkCycleStatus.IN_PROGRESS,
          currentStationId: nextOpen?.stationId ?? null,
        },
      });
    });

    return this.getCycle(projectId, workCycleId);
  }

  /** Single cycle with window type + progress + assignments. */
  async getCycle(projectId: string, workCycleId: string) {
    const cycle = await this.prisma.workCycle.findFirst({
      where: { id: workCycleId, projectId },
      include: {
        windowType: {
          select: {
            id: true,
            code: true,
            totalQty: true,
            hasAngles: true,
            instructionDocId: true,
          },
        },
        stationProgress: { orderBy: { stationId: 'asc' } },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!cycle) throw new NotFoundException('Work cycle not found');
    return cycle;
  }

  /**
   * Re-evaluate a window's cycle completion from its elevation-map units.
   * When the project manager marks every unit of a window DONE on the map, its
   * cycle is COMPLETED; un-marking a unit reverts it to IN_PROGRESS.
   */
  async recomputeCompletionFromElevation(
    projectId: string,
    windowTypeId: string | null | undefined,
  ): Promise<void> {
    if (!windowTypeId) return;
    const cycle = await this.prisma.workCycle.findUnique({
      where: { windowTypeId },
      select: { id: true, projectId: true, status: true },
    });
    if (!cycle || cycle.projectId !== projectId) return;

    const total = await this.prisma.elevationCell.count({
      where: { windowTypeId, map: { projectId } },
    });
    // No mapped units → the map can't drive this cycle's completion.
    if (total === 0) return;
    const pending = await this.prisma.elevationCell.count({
      where: {
        windowTypeId,
        map: { projectId },
        status: ElevationCellStatus.PENDING,
      },
    });
    const allDone = pending === 0;

    if (allDone && cycle.status !== WorkCycleStatus.COMPLETED) {
      await this.prisma.workCycle.update({
        where: { id: cycle.id },
        data: {
          status: WorkCycleStatus.COMPLETED,
          completedAt: new Date(),
          currentStationId: null,
          returnedAt: null,
          returnedFromStationId: null,
          returnReason: null,
        },
      });
    } else if (!allDone && cycle.status === WorkCycleStatus.COMPLETED) {
      await this.prisma.workCycle.update({
        where: { id: cycle.id },
        data: { status: WorkCycleStatus.IN_PROGRESS, completedAt: null },
      });
    }
  }

  /**
   * Mark a window's cycle RETURNED — a defect was returned from the elevation
   * map to a specific station with a reason.
   */
  async markReturnedFromElevation(
    projectId: string,
    windowTypeId: string | null | undefined,
    fromStationId: number,
    reason: string,
  ): Promise<void> {
    if (!windowTypeId) return;
    const cycle = await this.prisma.workCycle.findUnique({
      where: { windowTypeId },
      select: { id: true, projectId: true },
    });
    if (!cycle || cycle.projectId !== projectId) return;
    await this.prisma.workCycle.update({
      where: { id: cycle.id },
      data: {
        status: WorkCycleStatus.RETURNED,
        returnedAt: new Date(),
        returnedFromStationId: fromStationId,
        returnReason: reason.trim().slice(0, 1000),
        completedAt: null,
      },
    });
  }

  /** Whether the project uses the work-cycle model (any cycle exists). */
  async hasCycles(projectId: string): Promise<boolean> {
    const count = await this.prisma.workCycle.count({ where: { projectId } });
    return count > 0;
  }

  /** True when every work cycle of the project is COMPLETED (and at least one exists). */
  async allCyclesCompleted(projectId: string): Promise<boolean> {
    const [total, done] = await this.prisma.$transaction([
      this.prisma.workCycle.count({ where: { projectId } }),
      this.prisma.workCycle.count({
        where: { projectId, status: WorkCycleStatus.COMPLETED },
      }),
    ]);
    return total > 0 && total === done;
  }

  /** Keep the project-level state aligned with its first launched cycle. */
  private async promoteProjectToProduction(projectId: string): Promise<void> {
    const totals = await this.prisma.workCycle.aggregate({
      where: { projectId },
      _sum: { targetQty: true },
    });
    const totalItems = Math.max(1, totals._sum.targetQty ?? 0);

    await this.prisma.projectOrder.updateMany({
      where: {
        id: projectId,
        flowStatus: ProjectFlowStatus.PENDING_PLANNING,
      },
      data: {
        flowStatus: ProjectFlowStatus.IN_PRODUCTION,
        status: OrderStatus.IN_PROGRESS,
        totalItems,
      },
    });

    // Repair projects already promoted by an older launch implementation that
    // left the station header target at zero.
    await this.prisma.projectOrder.updateMany({
      where: { id: projectId, totalItems: { lte: 0 } },
      data: { totalItems },
    });
  }

  /** Guard: mutations only while the project is in production. */
  protected async assertInProduction(projectId: string): Promise<void> {
    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { flowStatus: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (project.flowStatus !== ProjectFlowStatus.IN_PRODUCTION) {
      throw new BadRequestException('Project is not in production');
    }
  }

  /** Narrowing helper for JSON payloads. */
  protected asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
