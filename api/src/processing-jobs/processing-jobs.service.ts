import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, ProcessingJob, ProcessingJobKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** How often the in-process worker checks for a new pending job. */
const POLL_INTERVAL_MS = 1200;

export type ProcessingJobHandler = (
  job: ProcessingJob,
) => Promise<Prisma.InputJsonValue | undefined>;

export interface ProcessingJobDto {
  id: string;
  kind: ProcessingJobKind;
  status: string;
  progress: number;
  progressMessage: string | null;
  error: string | null;
  result: unknown;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal DB-backed job queue for the heavy PDF-upload flows (elevation map,
 * per-window-type production instructions). No new infra (Redis/BullMQ) —
 * a single row per job in Postgres, claimed with `FOR UPDATE SKIP LOCKED` so
 * it's safe even if this process runs with more than one worker/replica.
 *
 * Feature services register a handler per `kind` (see `registerHandler`);
 * this service only owns the generic lifecycle (create/claim/progress/finish).
 */
@Injectable()
export class ProcessingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessingJobsService.name);
  private readonly handlers = new Map<ProcessingJobKind, ProcessingJobHandler>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A feature service declares itself as the processor for a job kind. */
  registerHandler(kind: ProcessingJobKind, handler: ProcessingJobHandler): void {
    this.handlers.set(kind, handler);
  }

  async createJob(
    kind: ProcessingJobKind,
    projectId: string,
    payload: Prisma.InputJsonValue,
  ): Promise<ProcessingJob> {
    const job = await this.prisma.processingJob.create({
      data: { kind, projectId, payload, status: 'PENDING' },
    });
    // Nudge the poller immediately instead of waiting for the next tick —
    // keeps perceived latency low without needing a pub/sub channel.
    void this.pollOnce();
    return job;
  }

  async getJob(id: string): Promise<ProcessingJobDto | null> {
    const job = await this.prisma.processingJob.findUnique({ where: { id } });
    return job ? this.toDto(job) : null;
  }

  async updateProgress(
    id: string,
    progress: number,
    message?: string,
  ): Promise<void> {
    await this.prisma.processingJob
      .update({
        where: { id },
        data: {
          progress: Math.max(0, Math.min(100, Math.round(progress))),
          ...(message !== undefined ? { progressMessage: message } : {}),
        },
      })
      .catch(() => undefined);
  }

  private toDto(job: ProcessingJob): ProcessingJobDto {
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
      progressMessage: job.progressMessage,
      error: job.error,
      result: job.result,
      projectId: job.projectId,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /** Claim a single PENDING job atomically (safe under concurrent pollers). */
  private async claimNextJob(): Promise<ProcessingJob | null> {
    const rows = await this.prisma.$queryRaw<ProcessingJob[]>(Prisma.sql`
      UPDATE "ProcessingJob"
      SET "status" = 'PROCESSING', "startedAt" = now(), "updatedAt" = now(),
          "attempts" = "attempts" + 1, "progress" = 0
      WHERE "id" = (
        SELECT "id" FROM "ProcessingJob"
        WHERE "status" = 'PENDING'
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *;
    `);
    return rows[0] ?? null;
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      // Drain whatever is pending right now rather than one job per tick.
      for (;;) {
        const job = await this.claimNextJob().catch((err) => {
          this.logger.warn(`Failed to claim job: ${String(err)}`);
          return null;
        });
        if (!job) break;
        await this.runJob(job);
      }
    } finally {
      this.polling = false;
    }
  }

  private async runJob(job: ProcessingJob): Promise<void> {
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      this.logger.error(`No handler registered for job kind ${job.kind}`);
      await this.prisma.processingJob
        .update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            error: `No handler for ${job.kind}`,
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      return;
    }
    try {
      const result = await handler(job);
      await this.prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          progress: 100,
          result: result ?? Prisma.JsonNull,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(
        `Processing job ${job.id} (${job.kind}) failed: ${String(err)}`,
      );
      await this.prisma.processingJob
        .update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            error: (err instanceof Error ? err.message : String(err)).slice(
              0,
              1000,
            ),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }
}
