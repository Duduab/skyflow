import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryNoteStatus,
  NotificationKind,
  Prisma,
  SkyflowRole,
  TrackingPhase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** מי מבצע את הבקשה — מגיע מ-JWT (req.user). */
export interface TrackingActor {
  userId?: string;
  role?: SkyflowRole;
}

export type TrackingPhaseStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** מיון קוד שלב A/B/C… — אחרת לפי סדר אלפביתי. */
function stageRank(code: string): number {
  const c = (code || '').trim().toUpperCase();
  if (c.length === 1 && c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 65;
  const n = Number.parseInt(c, 10);
  return Number.isFinite(n) ? 1000 + n : 9999;
}

/** מיון חזית: כיוון + מספר + צד, e.g. S-w < S1-e < N4-e. */
function facadeRank(label: string): [string, number, string] {
  const m = /^([A-Za-z]+)(\d*)[-]?([A-Za-z]*)$/.exec((label || '').trim());
  if (!m) return [label, 0, ''];
  return [m[1].toUpperCase(), m[2] ? Number(m[2]) : 0, m[3].toLowerCase()];
}

function phaseStatus(done: number, planned: number): TrackingPhaseStatus {
  if (done <= 0) return 'NOT_STARTED';
  if (done < planned) return 'IN_PROGRESS';
  return 'DONE';
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * מוודא הרשאת גישה לפרויקט: ADMIN/PLANNING תמיד; SITE_MANAGER רק אם הוא
   * מנהל הפרויקט המשובץ. מחזיר את הפרויקט לשימוש חוזר.
   */
  private async assertAccess(projectId: string, actor: TrackingActor) {
    const project = await this.prisma.projectOrder.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, projectManagerUserId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (
      actor.role === SkyflowRole.SITE_MANAGER &&
      project.projectManagerUserId &&
      project.projectManagerUserId !== actor.userId
    ) {
      throw new ForbiddenException('לא משובץ כמנהל הפרויקט');
    }
    return project;
  }

  /**
   * יצירה/סנכרון של שורות המעקב מכמויות התכנון (FacadeQuantity). אידמפוטנטי:
   * מעדכן כמות מתוכננת/שלב/קבוצה, יוצר שורות חסרות, ולא נוגע בפעימות/הערות.
   */
  async generateRows(projectId: string): Promise<number> {
    const [facades, facadeQuantities] = await Promise.all([
      this.prisma.facade.findMany({
        where: { projectId },
        select: {
          label: true,
          groupKey: true,
          stage: { select: { code: true } },
        },
      }),
      this.prisma.facadeQuantity.findMany({
        where: { windowType: { projectId } },
        select: {
          facadeLabel: true,
          qty: true,
          windowType: { select: { id: true, code: true } },
        },
      }),
    ]);

    const facadeByLabel = new Map(facades.map((f) => [f.label, f]));

    const rows = facadeQuantities
      .filter((fq) => fq.qty > 0)
      .map((fq) => {
        const facade = facadeByLabel.get(fq.facadeLabel);
        return {
          facadeLabel: fq.facadeLabel,
          facadeGroup: facade?.groupKey ?? '',
          stageCode: facade?.stage?.code ?? '',
          moduleCode: fq.windowType.code.trim(),
          windowTypeId: fq.windowType.id,
          plannedQty: fq.qty,
        };
      });

    rows.sort((a, b) => {
      const sr = stageRank(a.stageCode) - stageRank(b.stageCode);
      if (sr) return sr;
      const [ad, an, as] = facadeRank(a.facadeLabel);
      const [bd, bn, bs] = facadeRank(b.facadeLabel);
      if (ad !== bd) return ad < bd ? -1 : 1;
      if (an !== bn) return an - bn;
      if (as !== bs) return as < bs ? -1 : 1;
      return a.moduleCode.localeCompare(b.moduleCode);
    });

    await this.prisma.$transaction(
      rows.map((r, i) =>
        this.prisma.moduleTrackingRow.upsert({
          where: {
            projectId_facadeLabel_moduleCode: {
              projectId,
              facadeLabel: r.facadeLabel,
              moduleCode: r.moduleCode,
            },
          },
          create: {
            projectId,
            facadeLabel: r.facadeLabel,
            facadeGroup: r.facadeGroup,
            stageCode: r.stageCode,
            moduleCode: r.moduleCode,
            windowTypeId: r.windowTypeId,
            plannedQty: r.plannedQty,
            sortOrder: i,
          },
          update: {
            facadeGroup: r.facadeGroup,
            stageCode: r.stageCode,
            windowTypeId: r.windowTypeId,
            plannedQty: r.plannedQty,
            sortOrder: i,
          },
        }),
      ),
    );

    return rows.length;
  }

  /** טוען את כל תמונת המעקב לפרויקט: שורות, סיכומים, שלבים, תעודות משלוח. */
  async getTracking(projectId: string, actor: TrackingActor) {
    const project = await this.assertAccess(projectId, actor);

    let rows = await this.loadRows(projectId);
    if (rows.length === 0) {
      await this.generateRows(projectId);
      rows = await this.loadRows(projectId);
    }

    const deliveryNotes = await this.loadDeliveryNotes(projectId);

    const summary = {
      plannedQty: 0,
      producedQty: 0,
      suppliedQty: 0,
      installedQty: 0,
    };

    const stageMap = new Map<
      string,
      { code: string; facades: Set<string>; moduleCount: number; plannedQty: number }
    >();

    const view = rows.map((row) => {
      const produced = sumPhase(row.beats, TrackingPhase.PRODUCTION);
      const supplied = sumPhase(row.beats, TrackingPhase.SUPPLY);
      const installed = sumPhase(row.beats, TrackingPhase.INSTALL);

      summary.plannedQty += row.plannedQty;
      summary.producedQty += produced;
      summary.suppliedQty += supplied;
      summary.installedQty += installed;

      const st = stageMap.get(row.stageCode) ?? {
        code: row.stageCode,
        facades: new Set<string>(),
        moduleCount: 0,
        plannedQty: 0,
      };
      st.facades.add(row.facadeLabel);
      st.moduleCount += 1;
      st.plannedQty += row.plannedQty;
      stageMap.set(row.stageCode, st);

      return {
        id: row.id,
        stageCode: row.stageCode,
        facadeLabel: row.facadeLabel,
        facadeGroup: row.facadeGroup,
        floor: row.floor,
        moduleCode: row.moduleCode,
        windowTypeId: row.windowTypeId,
        plannedQty: row.plannedQty,
        notes: row.notes,
        sortOrder: row.sortOrder,
        production: {
          qty: produced,
          remaining: Math.max(0, row.plannedQty - produced),
          status: phaseStatus(produced, row.plannedQty),
        },
        supply: {
          qty: supplied,
          remaining: Math.max(0, row.plannedQty - supplied),
          status: phaseStatus(supplied, row.plannedQty),
        },
        install: {
          qty: installed,
          remaining: Math.max(0, row.plannedQty - installed),
          status: phaseStatus(installed, row.plannedQty),
        },
        beats: row.beats.map((b) => ({
          id: b.id,
          phase: b.phase,
          occurredOn: b.occurredOn,
          qty: b.qty,
          note: b.note,
          deliveryNoteId: b.deliveryNoteId,
          deliveryNoteNumber: b.deliveryNote?.noteNumber ?? null,
          createdAt: b.createdAt.toISOString(),
        })),
      };
    });

    const stageSummary = [...stageMap.values()]
      .sort((a, b) => stageRank(a.code) - stageRank(b.code))
      .map((s) => ({
        code: s.code,
        facadeCount: s.facades.size,
        moduleCount: s.moduleCount,
        plannedQty: s.plannedQty,
      }));

    const stages = stageSummary.map((s) => s.code).filter((c) => c);
    const facadeLabels = [...new Set(rows.map((r) => r.facadeLabel))];
    const moduleCodes = [...new Set(rows.map((r) => r.moduleCode))].sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      project: { id: project.id, name: project.name },
      summary: {
        ...summary,
        remainingProduction: Math.max(0, summary.plannedQty - summary.producedQty),
        remainingSupply: Math.max(0, summary.plannedQty - summary.suppliedQty),
        remainingInstall: Math.max(0, summary.plannedQty - summary.installedQty),
        producedPct: pct(summary.producedQty, summary.plannedQty),
        suppliedPct: pct(summary.suppliedQty, summary.plannedQty),
        installedPct: pct(summary.installedQty, summary.plannedQty),
      },
      stageSummary,
      filters: { stages, facadeLabels, moduleCodes },
      deliveryNotes,
      rows: view,
    };
  }

  async addBeat(
    projectId: string,
    rowId: string,
    dto: {
      phase: TrackingPhase;
      occurredOn: string;
      qty: number;
      deliveryNoteId?: string | null;
      note?: string | null;
    },
    actor: TrackingActor,
  ) {
    await this.assertAccess(projectId, actor);
    const row = await this.prisma.moduleTrackingRow.findUnique({
      where: { id: rowId },
      select: {
        id: true,
        projectId: true,
        moduleCode: true,
        facadeLabel: true,
        project: { select: { name: true } },
      },
    });
    if (!row || row.projectId !== projectId) {
      throw new NotFoundException('Tracking row not found');
    }
    if (!DATE_RE.test(dto.occurredOn)) {
      throw new BadRequestException('occurredOn must be YYYY-MM-DD');
    }
    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new BadRequestException('qty must be a positive integer');
    }
    let deliveryNoteId: string | null = null;
    if (dto.phase === TrackingPhase.SUPPLY && dto.deliveryNoteId) {
      const note = await this.prisma.projectDeliveryNote.findUnique({
        where: { id: dto.deliveryNoteId },
        select: { id: true, projectId: true },
      });
      if (!note || note.projectId !== projectId) {
        throw new BadRequestException('Delivery note does not belong to project');
      }
      deliveryNoteId = note.id;
    }
    await this.prisma.moduleTrackingBeat.create({
      data: {
        rowId,
        phase: dto.phase,
        occurredOn: dto.occurredOn,
        qty: dto.qty,
        deliveryNoteId,
        note: dto.note?.trim() || null,
        createdByUserId: actor.userId ?? null,
      },
    });

    await this.notifications.emit({
      kind: NotificationKind.TRACKING_BEAT,
      titleKey: 'NOTIFICATIONS.TRACKING_BEAT_TITLE',
      bodyKey: 'NOTIFICATIONS.TRACKING_BEAT_BODY',
      params: {
        phase: dto.phase,
        qty: dto.qty,
        module: row.moduleCode,
        facade: row.facadeLabel,
        project: row.project?.name ?? '',
      },
      link: `/admin/projects/${projectId}/control`,
      projectId,
      projectName: row.project?.name ?? null,
      actorUserId: actor.userId ?? null,
    });

    return this.getTracking(projectId, actor);
  }

  async deleteBeat(projectId: string, beatId: string, actor: TrackingActor) {
    await this.assertAccess(projectId, actor);
    const beat = await this.prisma.moduleTrackingBeat.findUnique({
      where: { id: beatId },
      select: { id: true, row: { select: { projectId: true } } },
    });
    if (!beat || beat.row.projectId !== projectId) {
      throw new NotFoundException('Beat not found');
    }
    await this.prisma.moduleTrackingBeat.delete({ where: { id: beatId } });
    return this.getTracking(projectId, actor);
  }

  async updateRowNotes(
    projectId: string,
    rowId: string,
    notes: string,
    actor: TrackingActor,
  ) {
    await this.assertAccess(projectId, actor);
    const row = await this.prisma.moduleTrackingRow.findUnique({
      where: { id: rowId },
      select: { id: true, projectId: true },
    });
    if (!row || row.projectId !== projectId) {
      throw new NotFoundException('Tracking row not found');
    }
    await this.prisma.moduleTrackingRow.update({
      where: { id: rowId },
      data: { notes: (notes ?? '').slice(0, 2000) },
    });
    return this.getTracking(projectId, actor);
  }

  async regenerate(projectId: string, actor: TrackingActor) {
    await this.assertAccess(projectId, actor);
    const count = await this.generateRows(projectId);
    const tracking = await this.getTracking(projectId, actor);
    return { ...tracking, generated: count };
  }

  private loadRows(projectId: string) {
    return this.prisma.moduleTrackingRow.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      include: {
        beats: {
          orderBy: { occurredOn: 'asc' },
          include: { deliveryNote: { select: { noteNumber: true } } },
        },
      },
    });
  }

  private async loadDeliveryNotes(projectId: string) {
    const notes = await this.prisma.projectDeliveryNote.findMany({
      where: { projectId },
      orderBy: { issuedAt: 'desc' },
      include: { issuedBy: { select: { firstName: true, lastName: true } } },
    });
    return notes.map((n) => ({
      id: n.id,
      noteNumber: n.noteNumber,
      shippingType: n.shippingType,
      status: n.status,
      active: n.status === DeliveryNoteStatus.ACTIVE,
      documentUrl: n.documentPath,
      externalPrice: n.externalPrice?.toString() ?? null,
      issuedAt: n.issuedAt.toISOString(),
      issuedByName: n.issuedBy
        ? `${n.issuedBy.firstName} ${n.issuedBy.lastName}`.trim()
        : null,
    }));
  }
}

function sumPhase(
  beats: { phase: TrackingPhase; qty: number }[],
  phase: TrackingPhase,
): number {
  return beats.reduce((s, b) => (b.phase === phase ? s + b.qty : s), 0);
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** נשמר לשימוש עתידי בשאילתות מותאמות. */
export type TrackingRowWhere = Prisma.ModuleTrackingRowWhereInput;
