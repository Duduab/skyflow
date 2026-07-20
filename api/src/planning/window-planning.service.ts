import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { WorkCycleService } from '../work-cycles/work-cycle.service';
import { parseQuantitiesPdf } from './pdf/quantities-pdf.parser';
import { parseWindowInstructionsPdf } from './pdf/window-instructions-pdf.parser';
import { parseAnglePdf } from './pdf/angle-pdf.parser';
import { detectAngleCodesForWindows } from './pdf/window-angle-vision';
import {
  extractWindowPartsFromPdf,
  type WindowPartsMapping,
} from './pdf/window-parts-vision';
import { extractWindowGlassFromPdf } from './pdf/window-glass-vision';
import { saveGlassPanelsForWindowType } from './window-glass-media';
import { WINDOW_CODE_RE } from './pdf/pdf-text.util';
import {
  normalizeWindowParts,
  sanitizeWindowPartsInput,
  type WindowPartsDto,
} from '../common/window-parts.util';
import { mapWithConcurrency } from '../common/concurrency.util';

/** Max windows processed concurrently when a single PDF describes several units. */
const WINDOW_PIPELINE_CONCURRENCY = 2;

/**
 * Turns the four planning PDFs (window instructions, quantities, ANG) into the
 * relational model (WindowType / FacadeQuantity / ProductionStage /
 * StageQuantity / Angle) and links elevation cells to window types by code.
 */
@Injectable()
export class WindowPlanningService {
  private readonly logger = new Logger(WindowPlanningService.name);
  private readonly anthropic: Anthropic | null;
  private readonly anthropicModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workCycles: WorkCycleService,
  ) {
    const apiKey = process.env['ANTHROPIC_API_KEY']?.trim();
    this.anthropicModel =
      process.env['ANTHROPIC_MODEL']?.trim() || 'claude-3-5-sonnet-latest';
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.anthropic) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — ANG codes will not be auto-detected from window drawings',
      );
    }
  }

  /** Window instructions PDF → WindowType rows (code, page, composition, angles). */
  async persistWindowInstructions(
    projectId: string,
    documentId: string,
    buffer: Buffer,
  ): Promise<{ windowsFound: number; anglesDetected: number }> {
    const parsed = await parseWindowInstructionsPdf(buffer);

    // ANG codes live inside the drawing (not the text layer) → read them with vision.
    const visionCodes = await this.detectAnglesFromDrawings(buffer, parsed.windows);

    const allAngleCodes = new Set<string>();
    // Windows are independent units — process a few concurrently (bounded, so
    // we don't fire off unbounded parallel Claude calls for a large sheet),
    // and within each window run the parts + glass vision passes together.
    await mapWithConcurrency(
      parsed.windows,
      WINDOW_PIPELINE_CONCURRENCY,
      async (win, i) => {
        const merged = [
          ...new Set([...(win.angleCodes ?? []), ...(visionCodes[i] ?? [])]),
        ];
        merged.forEach((c) => allAngleCodes.add(c));
        const hasAngles = merged.length > 0;
        const drawingPage = win.startPage ?? (win.pages?.[0] ?? 0);

        const [parts, compositionFromDrawing] = await Promise.all([
          this.detectPartsFromDrawings(buffer, win.pages ?? []),
          this.detectAndStoreGlass(projectId, win.code, buffer, drawingPage),
        ]);
        const partsData = parts.sections.length
          ? (parts as unknown as Prisma.InputJsonValue)
          : undefined;
        const composition =
          compositionFromDrawing ??
          (win.composition.length ? win.composition : null);
        const windowType = await this.prisma.windowType.upsert({
          where: { projectId_code: { projectId, code: win.code } },
          update: {
            instructionDocId: documentId,
            instructionPage: win.startPage,
            ...(composition
              ? { composition: composition as unknown as Prisma.InputJsonValue }
              : {}),
            hasAngles,
            angleCodes: merged as unknown as Prisma.InputJsonValue,
            setsPayload: win.setLabels as unknown as Prisma.InputJsonValue,
            ...(partsData ? { partsPayload: partsData } : {}),
          },
          create: {
            projectId,
            code: win.code,
            instructionDocId: documentId,
            instructionPage: win.startPage,
            composition: (composition ??
              win.composition) as unknown as Prisma.InputJsonValue,
            hasAngles,
            angleCodes: merged as unknown as Prisma.InputJsonValue,
            setsPayload: win.setLabels as unknown as Prisma.InputJsonValue,
            ...(partsData ? { partsPayload: partsData } : {}),
            sortOrder: i,
          },
          select: { id: true },
        });
        await this.workCycles.syncCycleStations(projectId, windowType.id);
      },
    );

    // Pre-create the required ANG rows so the wizard/laser know what must be uploaded,
    // even before the ANG PDFs themselves arrive.
    await this.ensureRequiredAngles(projectId, [...allAngleCodes]);

    await this.linkElevationCellsToWindowTypes(projectId);
    return {
      windowsFound: parsed.windows.length,
      anglesDetected: allAngleCodes.size,
    };
  }

  /**
   * Per-window-type instruction upload (from the quantities table row).
   * The file is a single unit's instruction sheet → parse it and apply the
   * results to THAT window type only (composition/sets/angles), link the doc,
   * and detect ANG codes with vision. Angles map by code (shared project rows).
   */
  async persistWindowInstructionsForType(
    projectId: string,
    windowTypeId: string,
    documentId: string,
    buffer: Buffer,
    onProgress?: (progress: number, message?: string) => void | Promise<void>,
  ): Promise<{ anglesDetected: number }> {
    const report = onProgress ?? (() => undefined);
    const wt = await this.prisma.windowType.findFirst({
      where: { id: windowTypeId, projectId },
    });
    if (!wt) throw new NotFoundException('Window type not found');

    await report(10, 'PLANNING_PDF.PROGRESS_PARSING');
    const parsed = await parseWindowInstructionsPdf(buffer);
    // A per-unit file describes one window — use the first detected block if any.
    const win = parsed.windows[0];
    const pages = win?.pages ?? [0];
    const drawingPage = win?.startPage ?? pages[0] ?? 0;

    await report(25, 'PLANNING_PDF.PROGRESS_VISION');
    // ANG codes, the set/part tables, and the glass panels are three
    // independent vision passes over the same buffer — this is the dominant
    // cost of this endpoint, so run them concurrently instead of one after
    // another (was: render+5 calls, then render+5 calls, then render+1 call).
    const [[visionCodes = []], parts, compositionFromDrawing] = await Promise.all([
      this.detectAnglesFromDrawings(buffer, [{ pages }]),
      this.detectPartsFromDrawings(buffer, pages),
      this.detectAndStoreGlass(projectId, wt.code, buffer, drawingPage),
    ]);
    await report(70, 'PLANNING_PDF.PROGRESS_SAVING');

    const merged = [...new Set([...(win?.angleCodes ?? []), ...visionCodes])];
    const existingCodes = (Array.isArray(wt.angleCodes) ? wt.angleCodes : []) as string[];
    const angleCodes = merged.length ? merged : existingCodes;
    const composition =
      compositionFromDrawing ??
      (win?.composition?.length ? win.composition : null);

    await this.prisma.windowType.update({
      where: { id: windowTypeId },
      data: {
        instructionDocId: documentId,
        instructionPage: win?.startPage ?? 0,
        ...(composition
          ? { composition: composition as unknown as Prisma.InputJsonValue }
          : {}),
        ...(win?.setLabels?.length
          ? { setsPayload: win.setLabels as unknown as Prisma.InputJsonValue }
          : {}),
        ...(parts.sections.length
          ? { partsPayload: parts as unknown as Prisma.InputJsonValue }
          : {}),
        hasAngles: angleCodes.length > 0,
        angleCodes: angleCodes as unknown as Prisma.InputJsonValue,
      },
    });

    // Independent follow-ups (angle rows, elevation-cell linking, station
    // chain sync) — run concurrently rather than sequentially.
    await Promise.all([
      this.ensureRequiredAngles(projectId, merged),
      this.linkElevationCellsToWindowTypes(projectId),
      // Prepare station chain for assignment; cycle stays DRAFT until launched in step 3.
      this.workCycles.syncCycleStations(projectId, windowTypeId),
    ]);

    await report(100, 'PLANNING_PDF.PROGRESS_DONE');
    return { anglesDetected: merged.length };
  }

  /** Attach a connection-details appendix PDF to a single window type (view only). */
  async attachConnectionDetails(
    projectId: string,
    windowTypeId: string,
    documentId: string,
  ): Promise<void> {
    const wt = await this.prisma.windowType.findFirst({
      where: { id: windowTypeId, projectId },
      select: { id: true },
    });
    if (!wt) throw new NotFoundException('Window type not found');
    await this.prisma.windowType.update({
      where: { id: windowTypeId },
      data: { connectionDocId: documentId },
    });
  }

  /** Vision detection of ANG codes per window (empty when Anthropic isn't configured). */
  private async detectAnglesFromDrawings(
    buffer: Buffer,
    windows: { pages: number[] }[],
  ): Promise<string[][]> {
    if (!this.anthropic || !windows.length) {
      return windows.map(() => []);
    }
    try {
      return await detectAngleCodesForWindows(
        buffer,
        windows.map((w) => ({ pages: w.pages })),
        this.anthropic,
        this.anthropicModel,
      );
    } catch (err) {
      this.logger.warn(
        `ANG vision detection failed: ${err instanceof Error ? err.message : err}`,
      );
      return windows.map(() => []);
    }
  }

  /**
   * Read the set/part tables (profiles/seals/accessories) from the sheet's
   * later page(s). The first page is the drawing/composition; the tables live
   * on the following page(s). Returns an empty mapping if vision is unavailable
   * or nothing is found.
   */
  private async detectPartsFromDrawings(
    buffer: Buffer,
    pages: number[],
  ): Promise<WindowPartsMapping> {
    if (!this.anthropic || !pages.length) return { sections: [] };
    // Prefer the pages after the first (page 2+ holds the set tables); if the
    // sheet is a single page, scan that page.
    const tablePages = pages.length > 1 ? pages.slice(1) : pages;
    try {
      return await extractWindowPartsFromPdf(
        buffer,
        tablePages,
        this.anthropic,
        this.anthropicModel,
      );
    } catch (err) {
      this.logger.warn(
        `Parts vision extraction failed: ${err instanceof Error ? err.message : err}`,
      );
      return { sections: [] };
    }
  }

  /**
   * Detect the glass panels (WM / GM codes) from the colored elevation drawing so
   * the gluing station can show the actual glass rectangles. Runs on the first
   * page (the drawing/composition page). Saves crops + manifest; no-op when
   * vision is unavailable or nothing is found.
   */
  private async detectAndStoreGlass(
    projectId: string,
    windowTypeCode: string,
    buffer: Buffer,
    drawingPage: number,
  ): Promise<string[] | null> {
    if (!this.anthropic) return null;
    try {
      const extracted = await extractWindowGlassFromPdf(
        buffer,
        drawingPage,
        this.anthropic,
        this.anthropicModel,
      );
      if (extracted.glass.length) {
        await saveGlassPanelsForWindowType(
          projectId,
          windowTypeCode,
          extracted.glass,
        );
      }
      if (extracted.compositionTopDown.length) {
        return [...extracted.compositionTopDown].reverse();
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Glass vision detection failed for ${windowTypeCode}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * Create an Angle row (code only) for each required code that doesn't exist yet.
   * Existing rows (qty/instructionDoc from an uploaded ANG PDF) are left untouched.
   * Batched into a single createMany instead of one round-trip per code.
   */
  private async ensureRequiredAngles(
    projectId: string,
    codes: string[],
  ): Promise<void> {
    if (!codes.length) return;
    const existing = await this.prisma.angle.findMany({
      where: { projectId },
      select: { code: true, sortOrder: true },
    });
    const existingCodes = new Set(existing.map((a) => a.code));
    let nextSort = existing.reduce((m, a) => Math.max(m, a.sortOrder + 1), 0);
    const toCreate = [...new Set(codes)].filter((c) => !existingCodes.has(c));
    if (!toCreate.length) return;
    await this.prisma.angle.createMany({
      data: toCreate.map((code) => ({
        projectId,
        code,
        qty: 0,
        sortOrder: nextSort++,
      })),
      skipDuplicates: true,
    });
  }

  /** Quantities PDF → WindowType totals + FacadeQuantity + ProductionStage + StageQuantity. */
  async persistQuantities(
    projectId: string,
    buffer: Buffer,
  ): Promise<{ windowTypes: number; facades: number; stages: number }> {
    const parsed = await parseQuantitiesPdf(buffer);

    // Ensure a WindowType exists for every column code, set totalQty. Each
    // code is independent of the others, so upsert them concurrently instead
    // of one round-trip after another.
    const codeToId = new Map<string, string>();
    await Promise.all(
      parsed.windowTypes.map(async (code, idx) => {
        const total = parsed.totals[code] ?? 0;
        const wt = await this.prisma.windowType.upsert({
          where: { projectId_code: { projectId, code } },
          update: { totalQty: total },
          create: { projectId, code, totalQty: total, sortOrder: idx },
        });
        codeToId.set(code, wt.id);
        // Seed a DRAFT cycle per window; it flips to OPEN once instructions arrive.
        await this.workCycles.ensureDraftCycle(projectId, wt.id, total);
      }),
    );

    // facade quantities (replace) — collect rows and insert in one batch.
    await this.prisma.facadeQuantity.deleteMany({
      where: { windowType: { projectId } },
    });
    const facadeQuantityRows: {
      windowTypeId: string;
      facadeLabel: string;
      qty: number;
    }[] = [];
    for (const facade of parsed.facades) {
      for (const [code, qty] of Object.entries(facade.qtys)) {
        const wtId = codeToId.get(code);
        if (!wtId || !qty) continue;
        facadeQuantityRows.push({
          windowTypeId: wtId,
          facadeLabel: facade.label,
          qty,
        });
      }
    }
    if (facadeQuantityRows.length) {
      await this.prisma.facadeQuantity.createMany({ data: facadeQuantityRows });
    }

    // stages (replace) — capture code→id to attach facades by stage. Stage
    // rows are created concurrently; their quantities are batched afterwards.
    await this.prisma.productionStage.deleteMany({ where: { projectId } });
    const stageCodeToId = new Map<string, string>();
    const stageQuantityRows: {
      stageId: string;
      windowTypeId: string;
      qty: number;
    }[] = [];
    await Promise.all(
      parsed.stages.map(async (stage, idx) => {
        const created = await this.prisma.productionStage.create({
          data: {
            projectId,
            code: stage.code,
            colorHex: stage.colorHex,
            sortOrder: idx,
          },
        });
        stageCodeToId.set(stage.code, created.id);
        for (const [code, qty] of Object.entries(stage.qtys)) {
          const wtId = codeToId.get(code);
          if (!wtId || !qty) continue;
          stageQuantityRows.push({ stageId: created.id, windowTypeId: wtId, qty });
        }
      }),
    );
    if (stageQuantityRows.length) {
      await this.prisma.stageQuantity.createMany({ data: stageQuantityRows });
    }

    // facades (replace) — each sub-facade belongs to a single stage (by color)
    // and later requires its own elevation-map PDF. Preserve an already-uploaded
    // elevation doc across re-parses (match by label).
    const priorFacades = await this.prisma.facade.findMany({
      where: { projectId },
      select: { label: true, elevationDocId: true },
    });
    const priorElevationByLabel = new Map(
      priorFacades.map((f) => [f.label, f.elevationDocId]),
    );
    await this.prisma.facade.deleteMany({ where: { projectId } });
    const facadeCreateRows = parsed.facades.map((facade, idx) => {
      const total =
        facade.total ??
        Object.values(facade.qtys).reduce((s, q) => s + q, 0);
      return {
        projectId,
        label: facade.label,
        groupKey: facade.label.split('-')[0],
        direction: facade.direction,
        totalQty: total,
        stageId: facade.stageCode
          ? (stageCodeToId.get(facade.stageCode) ?? null)
          : null,
        elevationDocId: priorElevationByLabel.get(facade.label) ?? null,
        sortOrder: idx,
      };
    });
    if (facadeCreateRows.length) {
      await this.prisma.facade.createMany({ data: facadeCreateRows });
    }

    await this.linkElevationCellsToWindowTypes(projectId);
    return {
      windowTypes: parsed.windowTypes.length,
      facades: facadeQuantityRows.length,
      stages: parsed.stages.length,
    };
  }

  /** ANG PDF → Angle rows (code, qty, instruction page). */
  async persistAngles(
    projectId: string,
    documentId: string,
    buffer: Buffer,
  ): Promise<{ anglesFound: number }> {
    const parsed = await parseAnglePdf(buffer);
    const existing = await this.prisma.angle.findMany({
      where: { projectId },
      select: { code: true, sortOrder: true },
    });
    const existingSort = new Map(existing.map((a) => [a.code, a.sortOrder]));
    let nextSort = existing.reduce((m, a) => Math.max(m, a.sortOrder + 1), 0);
    // Each code is an independent upsert — run them concurrently.
    await Promise.all(
      parsed.angles.map((angle) => {
        const sortOrder = existingSort.has(angle.code)
          ? existingSort.get(angle.code)!
          : nextSort++;
        return this.prisma.angle.upsert({
          where: { projectId_code: { projectId, code: angle.code } },
          update: {
            qty: angle.qty,
            instructionDocId: documentId,
            instructionPage: angle.page,
          },
          create: {
            projectId,
            code: angle.code,
            qty: angle.qty,
            instructionDocId: documentId,
            instructionPage: angle.page,
            sortOrder,
          },
        });
      }),
    );
    return { anglesFound: parsed.angles.length };
  }

  /**
   * Match elevation cells to window types by the window-type code found in the
   * cell text (74-1-03A). Sets windowTypeCode + windowTypeId on each cell.
   *
   * Cells are grouped by their resolved (code, windowTypeId) pair and updated
   * with one `updateMany` per group instead of one `update` per cell — for a
   * facade with hundreds of cells this turns hundreds of round-trips into a
   * handful (one per distinct window-type code).
   */
  async linkElevationCellsToWindowTypes(projectId: string): Promise<number> {
    const windowTypes = await this.prisma.windowType.findMany({
      where: { projectId },
      select: { id: true, code: true },
    });
    if (!windowTypes.length) return 0;
    const codeToId = new Map(windowTypes.map((w) => [w.code, w.id]));

    const cells = await this.prisma.elevationCell.findMany({
      where: { map: { projectId } },
      select: { id: true, code: true, items: true },
    });

    const groups = new Map<
      string,
      { code: string; wtId: string | null; ids: string[] }
    >();
    for (const cell of cells) {
      const code = this.extractWindowCode(cell.code, cell.items);
      if (!code) continue;
      const wtId = codeToId.get(code) ?? null;
      const key = `${code}::${wtId ?? ''}`;
      const group = groups.get(key);
      if (group) {
        group.ids.push(cell.id);
      } else {
        groups.set(key, { code, wtId, ids: [cell.id] });
      }
    }

    if (!groups.size) return 0;

    await this.prisma.$transaction(
      [...groups.values()].map((g) =>
        this.prisma.elevationCell.updateMany({
          where: { id: { in: g.ids } },
          data: { windowTypeCode: g.code, windowTypeId: g.wtId },
        }),
      ),
    );

    const linked = [...groups.values()]
      .filter((g) => g.wtId)
      .reduce((sum, g) => sum + g.ids.length, 0);
    this.logger.log(
      `Linked ${linked} elevation cells to window types for project ${projectId}`,
    );
    return linked;
  }

  private extractWindowCode(code: string, items: unknown): string | null {
    const direct = WINDOW_CODE_RE.exec(code);
    if (direct) return direct[1];
    const list = Array.isArray(items) ? (items as string[]) : [];
    for (const it of list) {
      const m = WINDOW_CODE_RE.exec(String(it));
      if (m) return m[1];
    }
    return null;
  }

  /** Aggregated preview for the wizard confirm screen. */
  /**
   * Persist a planner-reviewed/edited parts mapping for a single window type.
   * This is the "human confirm" step that guarantees the assembly worker sees
   * a 100%-correct mapping regardless of OCR imperfections.
   */
  async saveWindowTypeParts(
    projectId: string,
    windowTypeId: string,
    payload: unknown,
  ): Promise<WindowPartsDto> {
    const windowType = await this.prisma.windowType.findFirst({
      where: { id: windowTypeId, projectId },
      select: { id: true },
    });
    if (!windowType) {
      throw new NotFoundException('Window type not found');
    }
    const parts = sanitizeWindowPartsInput(payload);
    await this.prisma.windowType.update({
      where: { id: windowTypeId },
      data: { partsPayload: parts as unknown as Prisma.InputJsonValue },
    });
    return parts;
  }

  async buildPlanningPreview(projectId: string) {
    const [
      windowTypes,
      stages,
      angles,
      cellAgg,
      order,
      steelworkDetails,
      facadeRows,
    ] = await Promise.all([
      this.prisma.windowType.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: {
          facadeQuantities: true,
          instructionDoc: { select: { pdfPath: true, title: true } },
          connectionDoc: { select: { pdfPath: true } },
          _count: { select: { elevationCells: true } },
        },
      }),
      this.prisma.productionStage.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { stageQuantities: true },
      }),
      this.prisma.angle.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { instructionDoc: { select: { pdfPath: true, title: true } } },
      }),
      this.prisma.elevationCell.count({ where: { map: { projectId } } }),
      this.prisma.projectOrder.findUnique({
        where: { id: projectId },
        select: { angleSourcing: true },
      }),
      this.prisma.steelworkDetail.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { instructionDoc: { select: { pdfPath: true } } },
      }),
      this.prisma.facade.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
        include: { elevationDoc: { select: { pdfPath: true } } },
      }),
    ]);

    const totalUnits = windowTypes.reduce((s, w) => s + w.totalQty, 0);

    const DIRECTIONS: ('SOUTH' | 'NORTH' | 'WEST' | 'EAST')[] = [
      'SOUTH',
      'NORTH',
      'WEST',
      'EAST',
    ];
    const facadeView = facadeRows.map((f) => ({
      id: f.id,
      label: f.label,
      groupKey: f.groupKey || f.label.split('-')[0],
      direction: f.direction,
      totalQty: f.totalQty,
      stageId: f.stageId,
      elevationPdfUrl: f.elevationDoc?.pdfPath ?? null,
    }));

    // Facade GROUPS = elevation-map upload unit (S-w+S-e → S, W2 → W2).
    const directionOf = (key: string): 'SOUTH' | 'NORTH' | 'WEST' | 'EAST' => {
      const c = key.charAt(0).toUpperCase();
      if (c === 'N') return 'NORTH';
      if (c === 'W') return 'WEST';
      if (c === 'E') return 'EAST';
      return 'SOUTH';
    };
    const groupMap = new Map<
      string,
      {
        key: string;
        direction: 'SOUTH' | 'NORTH' | 'WEST' | 'EAST';
        subLabels: string[];
        totalQty: number;
        elevationPdfUrl: string | null;
        sortOrder: number;
      }
    >();
    facadeRows.forEach((f, i) => {
      const key = f.groupKey || f.label.split('-')[0];
      const existing = groupMap.get(key);
      if (existing) {
        existing.subLabels.push(f.label);
        existing.totalQty += f.totalQty;
        if (!existing.elevationPdfUrl && f.elevationDoc?.pdfPath) {
          existing.elevationPdfUrl = f.elevationDoc.pdfPath;
        }
      } else {
        groupMap.set(key, {
          key,
          direction: directionOf(key),
          subLabels: [f.label],
          totalQty: f.totalQty,
          elevationPdfUrl: f.elevationDoc?.pdfPath ?? null,
          sortOrder: i,
        });
      }
    });
    const facadeGroupsView = [...groupMap.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    /** Group a stage's facades by direction (skip empty directions). */
    const facadesByStage = (stageId: string) => {
      const list = facadeView.filter((f) => f.stageId === stageId);
      return DIRECTIONS.map((dir) => ({
        direction: dir,
        facades: list.filter((f) => f.direction === dir),
      })).filter((g) => g.facades.length > 0);
    };
    const facadeCount = facadeView.length;
    const facadesWithElevation = facadeView.filter(
      (f) => !!f.elevationPdfUrl,
    ).length;

    return {
      facades: facadeView,
      facadeCount,
      facadesWithElevation,
      facadeGroups: facadeGroupsView,
      facadeGroupCount: facadeGroupsView.length,
      facadeGroupsWithElevation: facadeGroupsView.filter(
        (g) => !!g.elevationPdfUrl,
      ).length,
      projectId,
      angleSourcing: order?.angleSourcing ?? 'INTERNAL_LASER',
      windowTypeCount: windowTypes.length,
      totalUnits,
      elevationCellCount: cellAgg,
      windowTypes: windowTypes.map((w) => ({
        id: w.id,
        code: w.code,
        totalQty: w.totalQty,
        hasAngles: w.hasAngles,
        angleCodes: (Array.isArray(w.angleCodes) ? w.angleCodes : []) as string[],
        composition: (Array.isArray(w.composition)
          ? w.composition
          : []) as string[],
        setLabels: (Array.isArray(w.setsPayload) ? w.setsPayload : []) as string[],
        instructionPdfUrl: w.instructionDoc?.pdfPath ?? null,
        instructionPage: w.instructionPage,
        connectionPdfUrl: w.connectionDoc?.pdfPath ?? null,
        facadeCount: w.facadeQuantities.length,
        elevationCellCount: w._count.elevationCells,
        parts: normalizeWindowParts(w.partsPayload),
      })),
      stages: stages.map((s) => {
        const facadeGroups = facadesByStage(s.id);
        const facadeTotal = facadeGroups.reduce(
          (sum, g) => sum + g.facades.reduce((a, f) => a + f.totalQty, 0),
          0,
        );
        return {
          code: s.code,
          colorHex: s.colorHex,
          totalQty: s.stageQuantities.reduce((sum, q) => sum + q.qty, 0),
          windowTypeCount: s.stageQuantities.length,
          facadeCount: facadeGroups.reduce((n, g) => n + g.facades.length, 0),
          facadeTotalQty: facadeTotal,
          facadeGroups: facadeGroups.map((g) => ({
            direction: g.direction,
            facades: g.facades.map((f) => ({
              id: f.id,
              label: f.label,
              totalQty: f.totalQty,
              elevationPdfUrl: f.elevationPdfUrl,
            })),
          })),
        };
      }),
      angles: angles.map((a) => ({
        code: a.code,
        qty: a.qty,
        instructionPdfUrl: a.instructionDoc?.pdfPath ?? null,
        instructionPage: a.instructionPage,
      })),
      steelworkDetails: steelworkDetails.map((d) => ({
        id: d.id,
        title: d.title,
        targetQty: d.targetQty,
        instructionPdfUrl: d.instructionDoc?.pdfPath ?? null,
      })),
    };
  }
}
