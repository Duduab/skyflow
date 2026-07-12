import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ElevationCellStatus, SkyflowRole } from '@prisma/client';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  detectElevationSignature,
  renderElevation,
  type RenderedCell,
  type SectionMeta,
} from './elevation-render.js';

/** Station id whose manager (SITE_MANAGER) installs on site. */
const SITE_STATION_ID = 7;

/**
 * Stored under the API's own `storage/` dir (not `web/public`) so files written
 * at runtime are served dynamically through `/api/elevation-maps/...` — works
 * with `ng serve` and split web/api deployments without a restart.
 */
export function elevationMapStorageDir(mapId: string): string {
  return join(process.cwd(), 'storage', 'elevation-maps', mapId);
}

export function ensureElevationMapDir(mapId: string): string {
  const dir = elevationMapStorageDir(mapId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface PageMeta {
  pageIndex: number;
  imageUrl: string;
  width: number;
  height: number;
  sections: SectionMeta[];
}

@Injectable()
export class ElevationService {
  private readonly logger = new Logger(ElevationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Content probe: does this PDF look like an elevation map? */
  async looksLikeElevation(fileBuffer: Buffer): Promise<boolean> {
    try {
      const res = await detectElevationSignature(fileBuffer);
      return res.isElevation;
    } catch (err) {
      this.logger.warn(`Elevation detection failed: ${String(err)}`);
      return false;
    }
  }

  /**
   * Analyze an uploaded ELEVATION_MAP PDF and persist the map + cells.
   * Preserves DONE status of previously-analyzed cells (matched by code).
   * Runs defensively: never throws to the caller — records FAILED status instead.
   */
  async analyzeDocument(params: {
    projectId: string;
    documentId: string;
    title: string;
    fileBuffer: Buffer;
  }): Promise<void> {
    const { projectId, documentId, title, fileBuffer } = params;

    // carry over previously completed cells (by code) from the latest existing map
    const previousDone = await this.collectPreviousDoneCodes(projectId);

    // remove any prior map tied to this document (re-upload of same doc)
    await this.prisma.elevationMap.deleteMany({ where: { documentId } });

    const map = await this.prisma.elevationMap.create({
      data: {
        projectId,
        documentId,
        title,
        status: 'PROCESSING',
        pageCount: 1,
        pages: [],
      },
    });

    try {
      const rendered = await renderElevation(fileBuffer);
      const dir = ensureElevationMapDir(map.id);
      const pages: PageMeta[] = [];

      for (const page of rendered.pages) {
        const fileName = `page-${page.pageIndex}.png`;
        writeFileSync(join(dir, fileName), page.pngBuffer);
        pages.push({
          pageIndex: page.pageIndex,
          imageUrl: `/api/elevation-maps/${map.id}/${fileName}`,
          width: page.width,
          height: page.height,
          sections: page.sections,
        });
      }

      const cellRows = rendered.pages.flatMap((page) =>
        page.cells.map((c: RenderedCell) => {
          const done = previousDone.get(this.cellKey(c.code, c.items));
          return {
            mapId: map.id,
            pageIndex: page.pageIndex,
            code: c.code.slice(0, 64),
            floor: c.floor,
            kind: c.kind,
            items: c.items,
            bbox: c.bbox,
            status: done
              ? ElevationCellStatus.DONE
              : ElevationCellStatus.PENDING,
            doneAt: done?.doneAt ?? null,
            doneByUserId: done?.doneByUserId ?? null,
          };
        }),
      );

      if (cellRows.length) {
        await this.prisma.elevationCell.createMany({ data: cellRows });
      }

      await this.prisma.elevationMap.update({
        where: { id: map.id },
        data: {
          status: 'READY',
          pageCount: rendered.pageCount,
          pages: pages as unknown as object,
        },
      });

      this.logger.log(
        `Elevation map ${map.id} ready: ${cellRows.length} cells, ${pages.length} page(s)`,
      );
    } catch (err) {
      this.logger.error(
        `Elevation analysis failed for project ${projectId}: ${String(err)}`,
      );
      await this.prisma.elevationMap.update({
        where: { id: map.id },
        data: { status: 'FAILED', error: String(err).slice(0, 1000) },
      });
    }
  }

  private cellKey(code: string, items: string[]): string {
    return `${code}::${items.join('|')}`;
  }

  private async collectPreviousDoneCodes(projectId: string): Promise<
    Map<string, { doneAt: Date | null; doneByUserId: string | null }>
  > {
    const result = new Map<
      string,
      { doneAt: Date | null; doneByUserId: string | null }
    >();
    const cells = await this.prisma.elevationCell.findMany({
      where: { map: { projectId }, status: 'DONE' },
      select: { code: true, items: true, doneAt: true, doneByUserId: true },
    });
    for (const c of cells) {
      const items = Array.isArray(c.items) ? (c.items as string[]) : [];
      result.set(this.cellKey(c.code, items), {
        doneAt: c.doneAt,
        doneByUserId: c.doneByUserId,
      });
    }
    return result;
  }

  /** Map + cells + progress for a project (latest READY/PROCESSING map). */
  async getForProject(projectId: string) {
    const map = await this.prisma.elevationMap.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        cells: {
          orderBy: [{ pageIndex: 'asc' }, { code: 'asc' }],
          include: {
            doneBy: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!map) return { map: null };

    // open defects per cell (return-to-station rework)
    const openDefects = await this.prisma.cellDefect.findMany({
      where: { projectId, status: 'OPEN' },
      select: { cellId: true, returnedToStationId: true, reason: true },
    });
    const defectByCell = new Map<
      string,
      { returnedToStationId: number; reason: string }
    >();
    for (const d of openDefects) {
      if (!defectByCell.has(d.cellId)) {
        defectByCell.set(d.cellId, {
          returnedToStationId: d.returnedToStationId,
          reason: d.reason,
        });
      }
    }

    const cells = map.cells.map((c) => ({
      id: c.id,
      pageIndex: c.pageIndex,
      code: c.code,
      floor: c.floor,
      kind: c.kind,
      items: (Array.isArray(c.items) ? c.items : []) as string[],
      bbox: c.bbox as { x: number; y: number; w: number; h: number },
      status: c.status,
      doneAt: c.doneAt?.toISOString() ?? null,
      doneBy: c.doneBy
        ? `${c.doneBy.firstName} ${c.doneBy.lastName}`.trim()
        : null,
      windowTypeCode: c.windowTypeCode ?? null,
      windowTypeId: c.windowTypeId ?? null,
      defect: defectByCell.get(c.id) ?? null,
    }));

    const total = cells.length;
    const done = cells.filter((c) => c.status === 'DONE').length;
    const byKind = (kind: 'SPANDREL' | 'UNIT') => {
      const list = cells.filter((c) => c.kind === kind);
      return { total: list.length, done: list.filter((c) => c.status === 'DONE').length };
    };

    // distinct window-type codes present on the map (for filtering)
    const windowTypeCodes = [
      ...new Set(cells.map((c) => c.windowTypeCode).filter((x): x is string => !!x)),
    ].sort();

    return {
      map: {
        id: map.id,
        title: map.title,
        status: map.status,
        pageCount: map.pageCount,
        pages: map.pages as unknown as PageMeta[],
        error: map.error,
      },
      cells,
      windowTypeCodes,
      progress: {
        total,
        done,
        pct: total ? Math.round((done / total) * 100) : 0,
        spandrel: byKind('SPANDREL'),
        unit: byKind('UNIT'),
        openDefects: openDefects.length,
      },
    };
  }

  /** Project manager marks a cell defective and returns the unit to a station. */
  async reportDefect(params: {
    projectId: string;
    cellId: string;
    returnedToStationId: number;
    reason: string;
    user: { userId: string; role: SkyflowRole };
  }) {
    const { projectId, cellId, returnedToStationId, reason, user } = params;
    await this.assertCanEditInstall(projectId, user);

    const cell = await this.prisma.elevationCell.findFirst({
      where: { id: cellId, map: { projectId } },
      select: { id: true },
    });
    if (!cell) throw new NotFoundException('Cell not found for this project');

    const defect = await this.prisma.cellDefect.create({
      data: {
        projectId,
        cellId,
        returnedToStationId,
        reason: reason.trim().slice(0, 1000),
        reportedByUserId: user.userId || null,
      },
    });
    // returning a unit re-opens its installation
    await this.prisma.elevationCell.update({
      where: { id: cellId },
      data: { status: ElevationCellStatus.PENDING, doneAt: null, doneByUserId: null },
    });
    return { ok: true, defectId: defect.id };
  }

  /** Open rework items returned to a specific station. */
  async listDefectsForStation(projectId: string, stationId: number) {
    const defects = await this.prisma.cellDefect.findMany({
      where: { projectId, returnedToStationId: stationId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: {
        cell: {
          select: { code: true, windowTypeCode: true, pageIndex: true },
        },
      },
    });
    return defects.map((d) => ({
      id: d.id,
      cellCode: d.cell.code,
      windowTypeCode: d.cell.windowTypeCode,
      reason: d.reason,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /** Station resolves a returned defect. */
  async resolveDefect(defectId: string) {
    const defect = await this.prisma.cellDefect.findUnique({
      where: { id: defectId },
    });
    if (!defect) throw new NotFoundException('Defect not found');
    await this.prisma.cellDefect.update({
      where: { id: defectId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return { ok: true };
  }

  private async assertCanEditInstall(
    projectId: string,
    user: { userId: string; role: SkyflowRole },
  ): Promise<void> {
    const isAdmin = user.role === SkyflowRole.ADMIN;
    let isSiteManager = false;
    if (user.role === SkyflowRole.SITE_MANAGER) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { managedStationId: true },
      });
      isSiteManager =
        dbUser?.managedStationId == null ||
        dbUser.managedStationId === SITE_STATION_ID;
    }
    if (!isAdmin && !isSiteManager) {
      throw new ForbiddenException(
        'Only the site manager or an admin can update installation status',
      );
    }
  }

  /** Batch toggle DONE/PENDING. Only SITE_MANAGER (station 7) or ADMIN. */
  async markCells(params: {
    projectId: string;
    cellIds: string[];
    done: boolean;
    user: { userId: string; role: SkyflowRole };
  }) {
    const { projectId, cellIds, done, user } = params;

    const isAdmin = user.role === SkyflowRole.ADMIN;
    let isSiteManager = false;
    if (user.role === SkyflowRole.SITE_MANAGER) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { managedStationId: true },
      });
      isSiteManager =
        dbUser?.managedStationId == null ||
        dbUser.managedStationId === SITE_STATION_ID;
    }
    if (!isAdmin && !isSiteManager) {
      throw new ForbiddenException(
        'Only the site manager or an admin can update installation status',
      );
    }

    if (!cellIds.length) return { updated: 0 };

    // ensure cells belong to this project's map
    const valid = await this.prisma.elevationCell.findMany({
      where: { id: { in: cellIds }, map: { projectId } },
      select: { id: true },
    });
    if (!valid.length) {
      throw new NotFoundException('No matching cells for this project');
    }
    const validIds = valid.map((c) => c.id);

    const res = await this.prisma.elevationCell.updateMany({
      where: { id: { in: validIds } },
      data: done
        ? {
            status: ElevationCellStatus.DONE,
            doneAt: new Date(),
            doneByUserId: user.userId,
          }
        : {
            status: ElevationCellStatus.PENDING,
            doneAt: null,
            doneByUserId: null,
          },
    });

    return { updated: res.count };
  }

  async deleteForDocument(documentId: string): Promise<void> {
    const maps = await this.prisma.elevationMap.findMany({
      where: { documentId },
      select: { id: true },
    });
    for (const m of maps) {
      try {
        rmSync(elevationMapStorageDir(m.id), { recursive: true, force: true });
      } catch {
        /* ignore fs cleanup errors */
      }
    }
    await this.prisma.elevationMap.deleteMany({ where: { documentId } });
  }
}
