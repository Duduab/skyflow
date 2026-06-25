import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeliveryNoteShippingType,
  DeliveryNoteStatus,
  Prisma,
  ProjectFlowStatus,
  SkyflowRole,
} from '@prisma/client';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { packPhotoRequiredCount } from '../common/pack-photo.util.js';
import {
  buildDeliveryNoteLineItems,
  buildLineItemPreviews,
  computeShippedByLineKey,
  deliveryNoteAbsolutePath,
  formatNoteNumber,
  resolveSelectedLineItems,
  sumExpectedCountsFromNotes,
  writeDeliveryNotePdf,
  type DeliveryNoteLineItem,
  type DeliveryNoteLineItemPreview,
} from '../common/delivery-note.util.js';
import { IssueDeliveryNoteDto } from '../stations/dto/issue-delivery-note.dto.js';
import { UpdateDeliveryNoteDto } from '../admin/dto/update-delivery-note.dto.js';

export type DeliveryNoteWorkerContext = {
  canIssue: boolean;
  hasActiveNote: boolean;
  allShipped: boolean;
  issuedCount: number;
  remainingItemCount: number;
  documentUrl: string | null;
  noteNumber: string | null;
  shippingType: DeliveryNoteShippingType | null;
  externalPrice: string | null;
  issuedAt: string | null;
  availableLineItems: DeliveryNoteLineItemPreview[];
  issuedNotes: {
    id: string;
    noteNumber: string;
    documentUrl: string;
    shippingType: DeliveryNoteShippingType;
    externalPrice: string | null;
    issuedAt: string;
    status: DeliveryNoteStatus;
    lineItemCount: number;
  }[];
};

@Injectable()
export class DeliveryNotesService {
  private readonly logger = new Logger(DeliveryNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  assertCanIssue(role: SkyflowRole, managedStationId: number | null): void {
    if (role === SkyflowRole.ADMIN) return;
    if (
      role !== SkyflowRole.STATION_MANAGER ||
      managedStationId !== 6
    ) {
      throw new ForbiddenException(
        'Station manager of station 6 required to issue delivery notes',
      );
    }
  }

  private async loadCatalog(projectId: string) {
    const [sawLines, productItems] = await Promise.all([
      this.prisma.sawStationWorkLine.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.productItem.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { components: true },
      }),
    ]);
    return buildDeliveryNoteLineItems(
      sawLines.map((l) => ({
        componentKind: l.componentKind,
        description: l.description,
        quantity: l.quantity,
        instructionKind: l.instructionKind,
        planningCutLengthMm: l.planningCutLengthMm,
        sawsProfileCode: l.sawsProfileCode,
      })),
      productItems.map((pi) => ({
        instructionKind: pi.instructionKind,
        label: pi.label,
        components: pi.components.map((c) => ({
          kind: c.kind,
          description: c.description,
          quantity: c.quantity,
          sawsProfileCode: c.sawsProfileCode,
        })),
      })),
    );
  }

  private async loadProjectNotes(projectId: string) {
    return this.prisma.projectDeliveryNote.findMany({
      where: { projectId },
      orderBy: { issuedAt: 'desc' },
    });
  }

  private mapIssuedNotes(
    notes: Awaited<ReturnType<DeliveryNotesService['loadProjectNotes']>>,
  ) {
    return notes.map((n) => {
      const items = n.lineItems as unknown as DeliveryNoteLineItem[];
      const lineItemCount = Array.isArray(items)
        ? items.reduce((s, li) => s + li.quantity, 0)
        : 0;
      return {
        id: n.id,
        noteNumber: n.noteNumber,
        documentUrl: n.documentPath,
        shippingType: n.shippingType,
        externalPrice: n.externalPrice?.toString() ?? null,
        issuedAt: n.issuedAt.toISOString(),
        status: n.status,
        lineItemCount,
      };
    });
  }

  async buildWorkerContext(
    projectId: string,
    packComplete: boolean,
  ): Promise<DeliveryNoteWorkerContext> {
    const [catalog, notes] = await Promise.all([
      this.loadCatalog(projectId),
      this.loadProjectNotes(projectId),
    ]);
    const shippedByKey = computeShippedByLineKey(notes);
    const availableLineItems = buildLineItemPreviews(catalog, shippedByKey);
    const remainingItemCount = availableLineItems.reduce(
      (s, i) => s + i.remainingQuantity,
      0,
    );
    const activeNotes = notes.filter((n) => n.status === DeliveryNoteStatus.ACTIVE);
    const latestActive = activeNotes[0] ?? null;
    const allShipped = remainingItemCount === 0 && catalog.length > 0;

    return {
      canIssue: packComplete && remainingItemCount > 0,
      hasActiveNote: activeNotes.length > 0,
      allShipped,
      issuedCount: activeNotes.length,
      remainingItemCount,
      documentUrl: latestActive?.documentPath ?? null,
      noteNumber: latestActive?.noteNumber ?? null,
      shippingType: latestActive?.shippingType ?? null,
      externalPrice: latestActive?.externalPrice?.toString() ?? null,
      issuedAt: latestActive?.issuedAt.toISOString() ?? null,
      availableLineItems,
      issuedNotes: this.mapIssuedNotes(notes),
    };
  }

  async getPreview(projectId: string) {
    const order = await this.ordersService.findOne(projectId);
    if (order.flowStatus === ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning not approved — stations are locked',
      );
    }
    const packReport = await this.packReportComplete(projectId, order.totalItems);
    const ctx = await this.buildWorkerContext(projectId, packReport);
    return {
      packComplete: packReport,
      ...ctx,
    };
  }

  private async packReportComplete(projectId: string, totalItems: number) {
    const requiredCount = packPhotoRequiredCount(totalItems);
    const rows = await this.prisma.packReportPhoto.findMany({
      where: { projectId },
    });
    const photos = rows.map((r) => r.slotIndex);
    return Array.from({ length: requiredCount }, (_, i) =>
      photos.includes(i),
    ).every(Boolean);
  }

  async issue(
    dto: IssueDeliveryNoteDto,
    reporterUserId: string | null,
    role: SkyflowRole,
    managedStationId: number | null,
  ) {
    this.assertCanIssue(role, managedStationId);

    const order = await this.ordersService.findOne(dto.projectId);
    if (order.flowStatus === ProjectFlowStatus.PENDING_PLANNING) {
      throw new BadRequestException(
        'Planning not approved — stations are locked',
      );
    }
    const packComplete = await this.packReportComplete(
      dto.projectId,
      order.totalItems,
    );
    if (!packComplete) {
      throw new BadRequestException(
        'Complete pack photos before issuing a delivery note',
      );
    }
    if (
      dto.shippingType === DeliveryNoteShippingType.EXTERNAL &&
      (dto.externalPrice == null || !Number.isFinite(dto.externalPrice))
    ) {
      throw new BadRequestException(
        'externalPrice is required for external shipping',
      );
    }

    const [catalog, notes] = await Promise.all([
      this.loadCatalog(dto.projectId),
      this.loadProjectNotes(dto.projectId),
    ]);
    const previews = buildLineItemPreviews(
      catalog,
      computeShippedByLineKey(notes),
    );

    let lineItems: DeliveryNoteLineItem[];
    try {
      lineItems = resolveSelectedLineItems(previews, dto.lineItems);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid line items',
      );
    }

    const noteCount = await this.prisma.projectDeliveryNote.count({
      where: { projectId: dto.projectId },
    });
    const noteNumber = formatNoteNumber(dto.projectId, noteCount + 1);
    const issuedAt = new Date();
    const isPartial = previews.some(
      (p) =>
        lineItems.find((l) => l.lineKey === p.lineKey)?.quantity !==
        p.remainingQuantity,
    );

    const { publicPath } = await writeDeliveryNotePdf({
      projectId: dto.projectId,
      projectName: order.name,
      noteNumber,
      shippingType: dto.shippingType,
      externalPrice:
        dto.shippingType === DeliveryNoteShippingType.EXTERNAL
          ? (dto.externalPrice ?? null)
          : null,
      lineItems,
      issuedAt,
      partialLabel: isPartial ? 'משלוח חלקי' : null,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const note = await tx.projectDeliveryNote.create({
        data: {
          projectId: dto.projectId,
          noteNumber,
          shippingType: dto.shippingType,
          externalPrice:
            dto.shippingType === DeliveryNoteShippingType.EXTERNAL
              ? dto.externalPrice
              : null,
          documentPath: publicPath,
          lineItems: lineItems as unknown as Prisma.InputJsonValue,
          issuedByUserId: reporterUserId,
          issuedAt,
        },
      });
      await this.syncProjectSiteAssembly(tx, dto.projectId, order.totalItems);
      return note;
    });

    await this.notifySiteManagers(created.id).catch((err) => {
      this.logger.warn(
        `Site manager notification failed for ${created.noteNumber}: ${err instanceof Error ? err.message : err}`,
      );
    });

    const expected = sumExpectedCountsFromNotes(
      await this.loadProjectNotes(dto.projectId),
      order.totalItems,
    );

    return {
      ok: true,
      id: created.id,
      noteNumber: created.noteNumber,
      shippingType: created.shippingType,
      externalPrice: created.externalPrice?.toString() ?? null,
      documentUrl: created.documentPath,
      issuedAt: created.issuedAt.toISOString(),
      lineItems,
      expected,
      isPartial,
    };
  }

  private async syncProjectSiteAssembly(
    tx: Prisma.TransactionClient,
    projectId: string,
    totalItems: number,
  ) {
    const notes = await tx.projectDeliveryNote.findMany({
      where: { projectId, status: DeliveryNoteStatus.ACTIVE },
      orderBy: { issuedAt: 'desc' },
    });
    const expected = sumExpectedCountsFromNotes(notes, totalItems);
    const latest = notes[0];
    await tx.projectOrder.update({
      where: { id: projectId },
      data: {
        siteDeliveryNotePath: latest?.documentPath ?? null,
        siteExpectedBeams: expected.beams,
        siteExpectedGlazing: expected.glazing,
        siteExpectedUnitized: expected.unitized,
      },
    });
  }

  async notifySiteManagers(noteId: string): Promise<void> {
    const note = await this.prisma.projectDeliveryNote.findUnique({
      where: { id: noteId },
      include: { project: { select: { name: true } } },
    });
    if (!note || note.status !== DeliveryNoteStatus.ACTIVE) return;

    const managers = await this.prisma.user.findMany({
      where: {
        role: SkyflowRole.SITE_MANAGER,
        managedStationId: 7,
      },
      select: { email: true, firstName: true, lastName: true },
    });
    if (!managers.length) {
      this.logger.warn('No site managers found for delivery note notification');
      return;
    }

    const appOrigin =
      this.config.get<string>('APP_ORIGIN')?.trim() ||
      this.config.get<string>('WEB_ORIGIN')?.trim() ||
      'http://localhost:4200';
    const docUrl = `${appOrigin}${note.documentPath}`;
    const shippingLabel =
      note.shippingType === DeliveryNoteShippingType.EXTERNAL
        ? 'משלוח חיצוני'
        : 'משלוח פנימי';
    const priceLine =
      note.shippingType === DeliveryNoteShippingType.EXTERNAL &&
      note.externalPrice != null
        ? `\nמחיר משלוח: ₪ ${note.externalPrice.toString()}`
        : '';

    const text = [
      `תעודת משלוח חדשה הופקה — ${note.project.name}`,
      `מספר תעודה: ${note.noteNumber}`,
      `סוג משלוח: ${shippingLabel}${priceLine}`,
      `קישור למסמך: ${docUrl}`,
      `היכנס לתחנת «הרכבה באתר» (7) כדי לצפות ולהתחיל לעבוד.`,
    ].join('\n');

    const emails = managers.map((m) => m.email).filter(Boolean);
    if (!emails.length) return;

    if (this.mail.isConfigured()) {
      await this.mail.sendDocumentPdf({
        to: emails,
        subject: `SkyFlow — תעודת משלוח ${note.noteNumber}`,
        text,
        absolutePdfPath: deliveryNoteAbsolutePath(note.documentPath),
        attachmentName: `${note.noteNumber}.pdf`,
      });
    } else {
      this.logger.warn(
        `SMTP not configured — delivery note notification logged only (${note.noteNumber})`,
      );
      this.logger.log(`Would notify: ${emails.join(', ')}\n${text}`);
    }

    await this.prisma.projectDeliveryNote.update({
      where: { id: noteId },
      data: { emailNotifiedAt: new Date() },
    });
  }

  async adminUpdate(noteId: string, dto: UpdateDeliveryNoteDto) {
    const note = await this.prisma.projectDeliveryNote.findUnique({
      where: { id: noteId },
      include: { project: { select: { id: true, name: true, totalItems: true } } },
    });
    if (!note) throw new NotFoundException('Delivery note not found');
    if (note.status !== DeliveryNoteStatus.ACTIVE) {
      throw new BadRequestException('Cannot edit a cancelled delivery note');
    }

    const shippingType = dto.shippingType ?? note.shippingType;
    let externalPrice: number | null =
      note.externalPrice != null ? Number(note.externalPrice) : null;
    if (dto.externalPrice !== undefined) {
      externalPrice = dto.externalPrice;
    }
    if (shippingType === DeliveryNoteShippingType.INTERNAL) {
      externalPrice = null;
    }
    if (
      shippingType === DeliveryNoteShippingType.EXTERNAL &&
      (externalPrice == null || !Number.isFinite(externalPrice))
    ) {
      throw new BadRequestException(
        'externalPrice is required for external shipping',
      );
    }

    const lineItems = note.lineItems as unknown as DeliveryNoteLineItem[];
    const { publicPath } = await writeDeliveryNotePdf({
      projectId: note.projectId,
      projectName: note.project.name,
      noteNumber: note.noteNumber,
      shippingType,
      externalPrice,
      lineItems,
      issuedAt: note.issuedAt,
    });

    const updated = await this.prisma.projectDeliveryNote.update({
      where: { id: noteId },
      data: {
        shippingType,
        externalPrice,
        documentPath: publicPath,
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.syncProjectSiteAssembly(
        tx,
        note.projectId,
        note.project.totalItems,
      );
    });

    return {
      ok: true,
      id: updated.id,
      noteNumber: updated.noteNumber,
      shippingType: updated.shippingType,
      externalPrice: updated.externalPrice?.toString() ?? null,
      documentUrl: updated.documentPath,
    };
  }

  async adminCancel(noteId: string) {
    const note = await this.prisma.projectDeliveryNote.findUnique({
      where: { id: noteId },
      include: { project: { select: { id: true, name: true, totalItems: true } } },
    });
    if (!note) throw new NotFoundException('Delivery note not found');
    if (note.status === DeliveryNoteStatus.CANCELLED) {
      return { ok: true, alreadyCancelled: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.projectDeliveryNote.update({
        where: { id: noteId },
        data: {
          status: DeliveryNoteStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
      await this.syncProjectSiteAssembly(
        tx,
        note.projectId,
        note.project.totalItems,
      );
    });

    return { ok: true, id: noteId, status: DeliveryNoteStatus.CANCELLED };
  }

  async listForAdmin(projectId?: string) {
    const where = projectId?.trim() ? { projectId: projectId.trim() } : {};
    const rows = await this.prisma.projectDeliveryNote.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      include: {
        project: { select: { id: true, name: true } },
        issuedBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });
    return rows.map((r) => {
      const items = r.lineItems as unknown as DeliveryNoteLineItem[];
      const lineItemCount = Array.isArray(items)
        ? items.reduce((s, li) => s + li.quantity, 0)
        : 0;
      const issuer = r.issuedBy
        ? `${r.issuedBy.firstName} ${r.issuedBy.lastName}`.trim()
        : null;
      return {
        id: r.id,
        projectId: r.projectId,
        projectName: r.project.name,
        noteNumber: r.noteNumber,
        shippingType: r.shippingType,
        status: r.status,
        externalPrice: r.externalPrice?.toString() ?? null,
        documentUrl: r.documentPath,
        issuedAt: r.issuedAt.toISOString(),
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        emailNotifiedAt: r.emailNotifiedAt?.toISOString() ?? null,
        issuedByName: issuer,
        lineItemCount,
      };
    });
  }

  async buildSiteAssemblyNotes(projectId: string, lastSiteLogAt: Date | null) {
    const notes = await this.prisma.projectDeliveryNote.findMany({
      where: { projectId, status: DeliveryNoteStatus.ACTIVE },
      orderBy: { issuedAt: 'desc' },
    });
    const hasNewDeliveryNote =
      notes.length > 0 &&
      (!lastSiteLogAt ||
        notes.some((n) => n.issuedAt > lastSiteLogAt));
    return {
      notes: notes.map((n) => ({
        id: n.id,
        noteNumber: n.noteNumber,
        documentUrl: n.documentPath,
        shippingType: n.shippingType,
        externalPrice: n.externalPrice?.toString() ?? null,
        issuedAt: n.issuedAt.toISOString(),
      })),
      hasNewDeliveryNote,
    };
  }
}
