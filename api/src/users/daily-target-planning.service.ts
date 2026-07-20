import { Injectable } from '@nestjs/common';
import { DailyTargetSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveStationDisplayNameHe } from '../common/station-presentation.util.js';
import {
  buildPlanningTargetDescription,
  buildWorkerLineItems,
  estimatePlanningTargetMinutes,
  planningDailyTargetDedupeKey,
  splitQtyEvenly,
  type PlanningSawLineInput,
  type StoredDailyTargetLineItem,
} from './daily-target-planning.util.js';

export type SyncPlanningDailyTargetsInput = {
  projectId: string;
  projectName: string;
  lineMaterial: 'ALUMINUM' | 'STEEL';
  machiningRoute: 'GLASS' | 'ALU_RANGER';
  stationId: number;
  workerUserIds: string[];
  managerUserId: string | null;
  sawLines: PlanningSawLineInput[];
  targetDate?: string;
};

@Injectable()
export class DailyTargetPlanningService {
  constructor(private readonly prisma: PrismaService) {}

  localDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** יצירת / עדכון יעדי יומי לעובדים ומנהל תחנה לאחר אישור תפ״י */
  async syncFromPlanningApproval(
    input: SyncPlanningDailyTargetsInput,
  ): Promise<void> {
    const assigneeIds = this.resolveAssigneeIds(
      input.workerUserIds,
      input.managerUserId,
    );
    const targetDate = input.targetDate?.trim() || this.localDateKey(new Date());
    const totalQty = input.sawLines.reduce((s, line) => s + line.quantity, 0);

    await this.prisma.$transaction(async (tx) => {
      await tx.userDailyTarget.deleteMany({
        where: {
          source: DailyTargetSource.PLANNING,
          projectId: input.projectId,
          stationId: input.stationId,
          targetDate,
          ...(assigneeIds.length
            ? { userId: { notIn: assigneeIds } }
            : {}),
        },
      });

      if (!assigneeIds.length || totalQty <= 0) return;

      const stationName = resolveStationDisplayNameHe(input.stationId, {
        lineMaterial: input.lineMaterial,
        machiningRoute: input.machiningRoute,
      });
      const shares = splitQtyEvenly(totalQty, assigneeIds.length);

      // Each assignee's target row is independent — upsert them concurrently
      // instead of one round-trip after another inside the transaction.
      await Promise.all(
        assigneeIds.map((userId, i) => {
          const targetQty = shares[i] ?? 0;
          if (targetQty <= 0) return null;

          const lineItems = buildWorkerLineItems(
            input.sawLines,
            i,
            assigneeIds.length,
          );
          const description = buildPlanningTargetDescription(
            input.projectName,
            stationName,
            targetQty,
          );
          const dedupeKey = planningDailyTargetDedupeKey(
            userId,
            targetDate,
            input.projectId,
            input.stationId,
          );

          return tx.userDailyTarget.upsert({
            where: { dedupeKey },
            create: {
              userId,
              targetDate,
              source: DailyTargetSource.PLANNING,
              projectId: input.projectId,
              stationId: input.stationId,
              description,
              targetQty,
              lineItems,
              targetMinutes: estimatePlanningTargetMinutes(targetQty),
              dedupeKey,
            },
            update: {
              description,
              targetQty,
              lineItems,
              targetMinutes: estimatePlanningTargetMinutes(targetQty),
            },
          });
        }),
      );
    });
  }

  resolveAssigneeIds(
    workerUserIds: string[],
    managerUserId: string | null,
  ): string[] {
    return [
      ...new Set([
        ...workerUserIds.filter(Boolean),
        ...(managerUserId ? [managerUserId] : []),
      ]),
    ];
  }

  /** השלמת פירוט קורות ליעדים ישנים שלא נשמרו עם lineItems */
  async resolveLineItemsForTarget(
    userId: string,
    projectId: string,
    stationId: number,
    stored: unknown,
  ): Promise<StoredDailyTargetLineItem[]> {
    const parsed = this.parseStoredLineItems(stored);
    if (parsed.length) return parsed;

    if (stationId !== 1) return [];

    const [sawLines, project] = await Promise.all([
      this.prisma.sawStationWorkLine.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        select: {
          description: true,
          quantity: true,
          sawsProfileCode: true,
          planningCutLengthMm: true,
          instructionKind: true,
          sortOrder: true,
        },
      }),
      this.prisma.projectOrder.findUnique({
        where: { id: projectId },
        select: {
          planningSawsManagerUserId: true,
          planningAssigneeUserId: true,
          planningSawsWorkers: {
            orderBy: { sortOrder: 'asc' },
            select: { userId: true },
          },
        },
      }),
    ]);
    if (!sawLines.length || !project) return [];

    const workerIds = project.planningSawsWorkers.map((w) => w.userId);
    const assigneeIds = this.resolveAssigneeIds(
      workerIds.length
        ? workerIds
        : project.planningAssigneeUserId
          ? [project.planningAssigneeUserId]
          : [],
      project.planningSawsManagerUserId,
    );
    const idx = assigneeIds.indexOf(userId);
    if (idx < 0) return [];

    const inputs: PlanningSawLineInput[] = sawLines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      sawsProfileCode: line.sawsProfileCode,
      planningCutLengthMm: line.planningCutLengthMm,
      instructionKind: line.instructionKind,
      sortOrder: line.sortOrder,
    }));

    return buildWorkerLineItems(inputs, idx, assigneeIds.length);
  }

  parseStoredLineItems(stored: unknown): StoredDailyTargetLineItem[] {
    if (!Array.isArray(stored)) return [];
    return stored
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const targetQty = Number(r.targetQty);
        if (!Number.isFinite(targetQty) || targetQty <= 0) return null;
        return {
          sortOrder: Number(r.sortOrder) || 0,
          description: String(r.description ?? '').trim(),
          profileCode:
            r.profileCode != null ? String(r.profileCode) : null,
          cutLengthMm:
            r.cutLengthMm != null && Number.isFinite(Number(r.cutLengthMm))
              ? Number(r.cutLengthMm)
              : null,
          instructionKind: String(r.instructionKind ?? ''),
          targetQty,
        } satisfies StoredDailyTargetLineItem;
      })
      .filter((row): row is StoredDailyTargetLineItem => row != null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
