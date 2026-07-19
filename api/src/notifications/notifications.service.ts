import { Injectable, Logger } from '@nestjs/common';
import { NotificationKind, Prisma, SkyflowRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Roles that oversee the whole plant and receive the production feed. */
const OVERSIGHT_ROLES: SkyflowRole[] = [SkyflowRole.ADMIN, SkyflowRole.PLANNING];

/** Payload for emitting a single domain event as fan-out notifications. */
export interface EmitNotificationInput {
  kind: NotificationKind;
  /** i18n key for the title (e.g. NOTIFICATIONS.CYCLE_REPORTED_TITLE). */
  titleKey: string;
  /** i18n key for the body line (optional). */
  bodyKey?: string;
  /** Interpolation params for the i18n templates (projectName, qty, station…). */
  params?: Record<string, unknown>;
  /** Relative route to open when the notification is clicked. */
  link?: string;
  projectId?: string | null;
  projectName?: string | null;
  stationId?: number | null;
  /** The user who caused the event — excluded from recipients, shown as "by …". */
  actorUserId?: string | null;
  /** Pre-resolved actor display name (avoids a lookup when already known). */
  actorName?: string | null;
  /** Extra recipient user IDs beyond the default oversight roles. */
  extraRecipientUserIds?: string[];
}

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  titleKey: string;
  bodyKey: string | null;
  params: Record<string, unknown> | null;
  link: string | null;
  projectId: string | null;
  projectName: string | null;
  stationId: number | null;
  actorName: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationDto[];
  unreadCount: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fan-out a domain event to every oversight user (minus the actor).
   * Best-effort: any failure is logged and swallowed so it never breaks the
   * business operation that triggered it.
   */
  async emit(input: EmitNotificationInput): Promise<void> {
    try {
      const actorId = input.actorUserId ?? undefined;

      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { role: { in: OVERSIGHT_ROLES } },
            ...(actorId ? [{ id: actorId }] : []),
            ...(input.extraRecipientUserIds?.length
              ? [{ id: { in: input.extraRecipientUserIds } }]
              : []),
          ],
        },
        select: { id: true, role: true, firstName: true, lastName: true },
      });

      const extra = new Set(input.extraRecipientUserIds ?? []);
      const recipientIds = users
        .filter(
          (u) =>
            u.id !== actorId &&
            (OVERSIGHT_ROLES.includes(u.role) || extra.has(u.id)),
        )
        .map((u) => u.id);

      if (recipientIds.length === 0) return;

      const actorName =
        input.actorName ??
        (() => {
          const a = actorId ? users.find((u) => u.id === actorId) : undefined;
          return a ? `${a.firstName} ${a.lastName}`.trim() : null;
        })();

      const params =
        input.params === undefined
          ? Prisma.JsonNull
          : (input.params as Prisma.InputJsonValue);

      await this.prisma.notification.createMany({
        data: recipientIds.map((recipientUserId) => ({
          kind: input.kind,
          titleKey: input.titleKey,
          bodyKey: input.bodyKey ?? null,
          params,
          link: input.link ?? null,
          projectId: input.projectId ?? null,
          projectName: input.projectName ?? null,
          stationId: input.stationId ?? null,
          actorUserId: actorId ?? null,
          actorName,
          recipientUserId,
        })),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit notification (${input.kind}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async listForUser(
    userId: string,
    limit = 40,
  ): Promise<NotificationListResult> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
      }),
      this.prisma.notification.count({
        where: { recipientUserId: userId, readAt: null },
      }),
    ]);

    return { items: rows.map((r) => this.toDto(r)), unreadCount };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { recipientUserId: userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.updateMany({
      where: { id, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return this.unreadCount(userId).then((r) => ({ unreadCount: r.count }));
  }

  async markAllRead(userId: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { unreadCount: 0 };
  }

  private toDto(row: {
    id: string;
    kind: NotificationKind;
    titleKey: string;
    bodyKey: string | null;
    params: Prisma.JsonValue | null;
    link: string | null;
    projectId: string | null;
    projectName: string | null;
    stationId: number | null;
    actorName: string | null;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: row.id,
      kind: row.kind,
      titleKey: row.titleKey,
      bodyKey: row.bodyKey,
      params: (row.params as Record<string, unknown> | null) ?? null,
      link: row.link,
      projectId: row.projectId,
      projectName: row.projectName,
      stationId: row.stationId,
      actorName: row.actorName,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
