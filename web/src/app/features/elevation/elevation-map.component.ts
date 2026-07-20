import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, take } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { CurrentUserService } from '../../core/current-user.service';
import {
  AnglePreviewDto,
  ElevationCellDto,
  ElevationFacadeOptionDto,
  ElevationMapResponse,
  ElevationProgressDto,
  FacadeDirection,
  PlanningPdfKind,
  WindowTypePreviewDto,
} from '../../core/skyflow.models';
import {
  stationMatIcon,
  stationMatIconFilled,
  stationVisualTokens,
} from '../../core/station-presentation';
import { MatIconComponent } from '../../shared/mat-icon/mat-icon.component';
import { UiButtonComponent } from '../../shared/ui-button.component';

/** Per-unit document set shown inside the cell popup (planning/embedded mode). */
export interface ElevationCellDocUpload {
  windowTypeId: string;
  kind: PlanningPdfKind;
  file: File;
}

@Component({
  selector: 'skyflow-elevation-map',
  standalone: true,
  imports: [NgClass, RouterLink, TranslateModule, MatIconComponent, UiButtonComponent],
  templateUrl: './elevation-map.component.html',
  styleUrl: './elevation-map.component.scss',
  // All state is signals/computed — OnPush skips redundant re-checks on this
  // grid's hundreds of cells while still updating on every signal change.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElevationMapComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly currentUser = inject(CurrentUserService);

  /**
   * Embedded mode (e.g. inside the planning "open" popup): when a project id is
   * provided as an input, the component skips the route params + role redirect
   * and shows the given facade group's map directly.
   */
  readonly embeddedProjectId = input<string | null>(null);
  readonly embeddedGroup = input<string | null>(null);
  readonly embedded = computed(() => !!this.embeddedProjectId());

  /**
   * Per-unit production documents (planning/embedded mode only). When provided,
   * the cell popup surfaces the matching window type's instruction / connection
   * / ANG files with open + upload controls.
   */
  readonly windowTypeDocs = input<WindowTypePreviewDto[]>([]);
  readonly angleDocs = input<AnglePreviewDto[]>([]);

  /**
   * Install-only mode (project-manager control page): keeps the interactive map
   * with mark-done / return-to-station, but hides the per-unit document cards and
   * the "launch unit" action, which belong to the planning flow.
   */
  readonly installMode = input<boolean>(false);
  /** `${windowTypeId}:${kind}` of the doc currently uploading (parent-driven). */
  readonly uploadingDocKey = input<string | null>(null);
  /** Emitted when the planner picks a file for a unit document in the popup. */
  readonly docUpload = output<ElevationCellDocUpload>();
  /** Emitted when the planner launches the unit to production (→ wizard step 3). */
  readonly launchRequested = output<{ windowTypeId: string; code: string }>();
  /** Embedded planner: cell already has instructions — open full unit-details instead. */
  readonly unitDetailsRequested = output<{ cell: ElevationCellDto }>();

  /** Unit docs can be edited whenever the map is embedded in the planner. */
  readonly docsEditable = computed(() => this.embedded() || this.canEdit());

  /** Documents for the window type of the currently open cell (embedded mode). */
  readonly activeCellDocs = computed(() => {
    if (!this.embedded() || this.installMode()) return null;
    const cell = this.activeCell();
    if (!cell) return null;
    const docs = this.windowTypeDocs();
    if (!docs.length) return null;
    const wt =
      docs.find((w) => cell.windowTypeId && w.id === cell.windowTypeId) ??
      docs.find(
        (w) => cell.windowTypeCode && w.code === cell.windowTypeCode,
      ) ??
      null;
    if (!wt) return null;
    const byCode = new Map(this.angleDocs().map((a) => [a.code, a]));
    const angles = (wt.angleCodes ?? []).map((code) => {
      const a = byCode.get(code);
      return { code, url: a?.instructionPdfUrl ?? null };
    });
    return {
      windowTypeId: wt.id,
      code: wt.code,
      instructionPdfUrl: wt.instructionPdfUrl,
      connectionPdfUrl: wt.connectionPdfUrl,
      hasAngles: wt.hasAngles,
      angles,
    };
  });

  isDocUploading(windowTypeId: string, kind: PlanningPdfKind): boolean {
    return this.uploadingDocKey() === `${windowTypeId}:${kind}`;
  }

  onDocFileSelected(
    windowTypeId: string,
    kind: PlanningPdfKind,
    fileList: FileList | null,
  ): void {
    const file = fileList && fileList.length ? fileList[0] : null;
    if (!file) return;
    this.docUpload.emit({ windowTypeId, kind, file });
  }

  /** Whether the active unit can be launched (its instruction PDF is uploaded). */
  readonly canLaunchUnit = computed(
    () => !!this.activeCellDocs()?.instructionPdfUrl,
  );

  /** Resolve preview docs for a map cell (embedded planning). */
  private cellWindowTypeDoc(cell: ElevationCellDto): WindowTypePreviewDto | null {
    const docs = this.windowTypeDocs();
    if (!docs.length) return null;
    return (
      docs.find((w) => cell.windowTypeId && w.id === cell.windowTypeId) ??
      docs.find((w) => cell.windowTypeCode && w.code === cell.windowTypeCode) ??
      null
    );
  }

  cellHasInstructionPdf(cell: ElevationCellDto): boolean {
    return !!this.cellWindowTypeDoc(cell)?.instructionPdfUrl;
  }

  /** Launch the unit to production and hand off to wizard step 3. */
  launchUnit(): void {
    const docs = this.activeCellDocs();
    if (!docs || !docs.instructionPdfUrl) return;
    this.launchRequested.emit({ windowTypeId: docs.windowTypeId, code: docs.code });
    this.closePopup();
  }

  readonly projectId = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly map = signal<ElevationMapResponse['map']>(null);
  readonly cells = signal<ElevationCellDto[]>([]);
  readonly progress = signal<ElevationProgressDto | null>(null);

  /** קבוצות חזיתות עם מפה — בורר החזיתות בתצוגת ההתקנה */
  readonly facades = signal<ElevationFacadeOptionDto[]>([]);
  readonly selectedFacadeGroup = signal<string | null>(null);

  /**
   * When the project has several facade maps, show a tile grid first (like
   * project-control) instead of jumping straight into the first map.
   * Embedded / single-facade views skip this and open the map directly.
   */
  readonly facadePickerOpen = signal(false);

  private readonly DIRECTION_ORDER: FacadeDirection[] = [
    'SOUTH',
    'NORTH',
    'WEST',
    'EAST',
  ];

  readonly facadesByDirection = computed(
    (): { direction: FacadeDirection; groups: ElevationFacadeOptionDto[] }[] => {
      const list = this.facades();
      return this.DIRECTION_ORDER.map((direction) => ({
        direction,
        groups: list.filter((f) => f.direction === direction),
      })).filter((d) => d.groups.length > 0);
    },
  );

  readonly showFacadePicker = computed(
    () => !this.embedded() && this.facadePickerOpen() && this.facades().length > 1,
  );

  directionKey(dir: FacadeDirection): string {
    return `PLANNING_PDF.DIR_${dir}`;
  }

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLElement>;

  readonly pageIndex = signal(0);
  readonly floorFilter = signal<string>('');
  readonly sectionFilter = signal<string>('');
  readonly windowTypeFilter = signal<string>('');
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly activeCell = signal<ElevationCellDto | null>(null);
  readonly hoveredCell = signal<ElevationCellDto | null>(null);
  readonly zoom = signal(1);

  readonly windowTypeCodes = signal<string[]>([]);

  /** תחנת היעד שנבחרה בסבב העבודה (החזרה לתחנה) — null כשאין. */
  readonly returnStationId = signal<number | null>(null);
  readonly defectReason = signal<string>('');
  readonly stationIds: number[] = [1, 2, 3, 4, 5, 6, 7, 8];

  readonly canEdit = computed(
    () => this.currentUser.isAdmin() || this.currentUser.isSiteManager(),
  );

  backRoute(): string {
    const path = this.router.url.split('?')[0];
    return path.startsWith('/admin/projects') ? '/admin/projects' : '/worker';
  }

  /** Label of the currently selected facade group (e.g. "דרום 5" / "S4"). */
  readonly activeFacadeLabel = computed(() => {
    const key = this.selectedFacadeGroup();
    if (!key) return null;
    return this.facades().find((f) => f.groupKey === key)?.label ?? null;
  });

  readonly currentPage = computed(() => {
    const m = this.map();
    if (!m) return null;
    return m.pages.find((p) => p.pageIndex === this.pageIndex()) ?? m.pages[0] ?? null;
  });

  /** Distinct floors across all cells, naturally sorted. */
  readonly floors = computed(() => {
    const set = new Set<string>();
    for (const c of this.cells()) if (c.floor) set.add(c.floor);
    return [...set].sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      if (a[0] !== b[0]) return a.localeCompare(b);
      return na - nb;
    });
  });

  /** Named horizontal sections (e.g. CENTRAL PART) detected on the current page. */
  readonly sections = computed(() => this.currentPage()?.sections ?? []);

  readonly activeSection = computed(() => {
    const label = this.sectionFilter();
    if (!label) return null;
    return this.sections().find((s) => s.label === label) ?? null;
  });

  readonly visibleCells = computed(() => {
    const pi = this.pageIndex();
    const sec = this.activeSection();
    return this.cells().filter((c) => {
      if (c.pageIndex !== pi) return false;
      if (sec) {
        const cx = c.bbox.x + c.bbox.w / 2;
        if (cx < sec.x0 || cx >= sec.x1) return false;
      }
      return true;
    });
  });

  /** Bounding band (normalized y-range) of the highlighted floor, for the overlay. */
  readonly floorBandRect = computed(() => {
    const ff = this.floorFilter();
    if (!ff) return null;
    const cells = this.visibleCells().filter((c) => (c.floor ?? '') === ff);
    if (!cells.length) return null;
    let top = 1;
    let bottom = 0;
    for (const c of cells) {
      top = Math.min(top, c.bbox.y);
      bottom = Math.max(bottom, c.bbox.y + c.bbox.h);
    }
    return { top, height: Math.max(0, bottom - top) };
  });

  readonly selectedCount = computed(() => this.selectedIds().size);

  ngOnInit(): void {
    // Embedded (popup) mode — use the provided project + group, no routing.
    const embedded = this.embeddedProjectId();
    if (embedded) {
      this.projectId.set(embedded);
      this.facadePickerOpen.set(false);
      this.selectedFacadeGroup.set(this.embeddedGroup());
      this.load();
      return;
    }
    const id = this.route.snapshot.paramMap.get('projectId') ?? '';
    const path = this.router.url.split('?')[0];
    const role = this.currentUser.sessionUser()?.role;
    if (
      id &&
      !path.startsWith('/admin/projects') &&
      (role === 'ADMIN' || role === 'PLANNING')
    ) {
      void this.router.navigate(['/admin/projects', id, 'elevation-map'], {
        replaceUrl: true,
      });
      return;
    }
    this.projectId.set(id);
    this.facadePickerOpen.set(true);
    this.load();
  }

  /** Open a facade map from the tile grid (install / worker flow). */
  openFacadeFromPicker(groupKey: string): void {
    this.facadePickerOpen.set(false);
    this.selectFacade(groupKey);
  }

  /** Return from a single facade map to the all-facades grid. */
  backToFacadePicker(): void {
    this.facadePickerOpen.set(true);
    this.activeCell.set(null);
    this.clearSelection();
  }

  /** Switch to another facade group's map (per-group elevation flow). */
  selectFacade(groupKey: string): void {
    if (this.selectedFacadeGroup() === groupKey && !this.facadePickerOpen()) return;
    this.selectedFacadeGroup.set(groupKey);
    this.pageIndex.set(0);
    this.floorFilter.set('');
    this.sectionFilter.set('');
    this.windowTypeFilter.set('');
    this.selectedIds.set(new Set());
    this.activeCell.set(null);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getElevationMap(this.projectId(), this.selectedFacadeGroup())
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.map.set(res.map);
          this.cells.set(res.cells ?? []);
          this.progress.set(res.progress ?? null);
          const facadeList = res.facades ?? [];
          this.facades.set(facadeList);
          this.selectedFacadeGroup.set(res.selectedFacadeGroup ?? null);
          if (this.embedded() || facadeList.length <= 1) {
            this.facadePickerOpen.set(false);
          }
          const codes =
            res.windowTypeCodes && res.windowTypeCodes.length
              ? [...res.windowTypeCodes]
              : [
                  ...new Set(
                    (res.cells ?? [])
                      .map((c) => c.windowTypeCode)
                      .filter((v): v is string => !!v),
                  ),
                ].sort((a, b) => a.localeCompare(b));
          this.windowTypeCodes.set(codes);
        },
        error: () => this.error.set('LOAD_FAILED'),
      });
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  /** לחיצה על מלבן חלון — פותחת פרטי יחידה (אם יש PDF) או פופאפ העלאה/הוצאה. */
  onCellClick(cell: ElevationCellDto): void {
    if (
      this.embedded() &&
      !this.installMode() &&
      this.cellHasInstructionPdf(cell)
    ) {
      this.unitDetailsRequested.emit({ cell });
      return;
    }
    this.activeCell.set(cell);
    this.returnStationId.set(null);
    this.defectReason.set('');
  }

  closePopup(): void {
    this.activeCell.set(null);
    this.returnStationId.set(null);
    this.defectReason.set('');
  }

  /** בחירת תחנה בסבב העבודה → פותח טופס החזרה לאותה תחנה (toggle). */
  chooseReturnStation(stationId: number): void {
    if (!this.canEdit()) return;
    this.returnStationId.set(
      this.returnStationId() === stationId ? null : stationId,
    );
    this.defectReason.set('');
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  selectAllVisible(): void {
    if (!this.canEdit()) return;
    const next = new Set(this.selectedIds());
    for (const c of this.visibleCells()) {
      if (this.hasActiveFilter() && !this.matchesFilters(c)) continue;
      next.add(c.id);
    }
    this.selectedIds.set(next);
  }

  /** True while any highlight filter (floor / window-type) is active. */
  readonly hasActiveFilter = computed(
    () => !!this.windowTypeFilter() || !!this.floorFilter(),
  );

  private matchesFilters(cell: ElevationCellDto): boolean {
    const wt = this.windowTypeFilter();
    const ff = this.floorFilter();
    if (wt && (cell.windowTypeCode ?? '') !== wt) return false;
    if (ff && (cell.floor ?? '') !== ff) return false;
    return true;
  }

  /** Whether this cell matches the active filter(s) and should be highlighted. */
  isCellHighlighted(cell: ElevationCellDto): boolean {
    return this.hasActiveFilter() && this.matchesFilters(cell);
  }

  /** Whether this cell should be dimmed while a filter is active. */
  isCellDimmed(cell: ElevationCellDto): boolean {
    return this.hasActiveFilter() && !this.matchesFilters(cell);
  }

  setFloor(floor: string): void {
    this.floorFilter.set(this.floorFilter() === floor ? '' : floor);
    this.activeCell.set(null);
    this.clearSelection();
  }

  setWindowType(code: string): void {
    if (!code) {
      this.windowTypeFilter.set('');
    } else {
      this.windowTypeFilter.set(this.windowTypeFilter() === code ? '' : code);
    }
    this.activeCell.set(null);
    this.clearSelection();
  }

  /** Select a named section ('' = full-map overview) and frame it. */
  setSection(label: string): void {
    this.sectionFilter.set(label);
    this.activeCell.set(null);
    this.clearSelection();
    this.frameSection();
  }

  /** Zoom + scroll the canvas so the active section fills the viewport. */
  private frameSection(): void {
    const sec = this.activeSection();
    if (!sec) {
      this.zoom.set(1);
      setTimeout(() => this.scrollCanvas(0, 0), 0);
      return;
    }
    const width = Math.max(0.08, sec.x1 - sec.x0);
    const z = Math.min(6, Math.max(1, +(1 / width).toFixed(2)));
    this.zoom.set(z);
    setTimeout(() => {
      const el = this.canvasRef?.nativeElement;
      if (!el) return;
      this.scrollCanvas(
        sec.x0 * el.scrollWidth,
        Math.max(0, sec.y0 - 0.02) * el.scrollHeight,
      );
    }, 0);
  }

  private scrollCanvas(left: number, top: number): void {
    const el = this.canvasRef?.nativeElement;
    if (!el) return;
    el.scrollLeft = left;
    el.scrollTop = top;
  }

  setPage(i: number): void {
    this.pageIndex.set(i);
    this.sectionFilter.set('');
    this.zoom.set(1);
    this.clearSelection();
  }

  zoomIn(): void {
    this.zoom.set(Math.min(4, +(this.zoom() + 0.25).toFixed(2)));
  }
  zoomOut(): void {
    this.zoom.set(Math.max(0.5, +(this.zoom() - 0.25).toFixed(2)));
  }
  zoomReset(): void {
    this.zoom.set(1);
  }

  markSelected(done: boolean): void {
    const ids = [...this.selectedIds()];
    if (!ids.length || this.busy()) return;
    this.busy.set(true);
    this.api
      .markElevationCells(this.projectId(), ids, done)
      .pipe(
        take(1),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          this.applyLocalMark(ids, done);
          this.clearSelection();
        },
        error: () => this.error.set('MARK_FAILED'),
      });
  }

  /** כפתור "השלם" — מסמן את היחידה כבוצעה או מבטל. */
  completeCell(): void {
    const cell = this.activeCell();
    if (!cell || !this.canEdit() || this.busy()) return;
    const done = cell.status !== 'DONE';
    this.busy.set(true);
    this.api
      .markElevationCells(this.projectId(), [cell.id], done)
      .pipe(
        take(1),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          this.applyLocalMark([cell.id], done);
          const updated = this.cells().find((c) => c.id === cell.id) ?? null;
          this.activeCell.set(updated);
        },
        error: () => this.error.set('MARK_FAILED'),
      });
  }

  private applyLocalMark(ids: string[], done: boolean): void {
    const set = new Set(ids);
    const who = this.currentUser.displayName();
    const nowIso = new Date().toISOString();
    this.cells.set(
      this.cells().map((c) =>
        set.has(c.id)
          ? {
              ...c,
              status: done ? 'DONE' : 'PENDING',
              doneAt: done ? nowIso : null,
              doneBy: done ? who : null,
            }
          : c,
      ),
    );
    this.recomputeProgress();
  }

  onDefectReasonInput(ev: Event): void {
    this.defectReason.set((ev.target as HTMLTextAreaElement).value);
  }

  /** החזרת היחידה לתחנה שנבחרה בסבב העבודה (rework). */
  submitReturn(): void {
    const cell = this.activeCell();
    const stationId = this.returnStationId();
    const reason = this.defectReason().trim();
    if (
      !cell ||
      stationId == null ||
      !this.canEdit() ||
      this.busy() ||
      reason.length < 2
    )
      return;
    this.busy.set(true);
    this.api
      .reportElevationDefect(this.projectId(), cell.id, stationId, reason)
      .pipe(
        take(1),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          const defect = { returnedToStationId: stationId, reason };
          this.cells.set(
            this.cells().map((c) =>
              c.id === cell.id
                ? { ...c, status: 'PENDING' as const, defect }
                : c,
            ),
          );
          this.activeCell.set(
            this.cells().find((c) => c.id === cell.id) ?? null,
          );
          this.returnStationId.set(null);
          this.defectReason.set('');
          this.recomputeProgress();
        },
        error: () => this.error.set('MARK_FAILED'),
      });
  }

  private recomputeProgress(): void {
    const cells = this.cells();
    const count = (kind: 'SPANDREL' | 'UNIT') => {
      const list = cells.filter((c) => c.kind === kind);
      return { total: list.length, done: list.filter((c) => c.status === 'DONE').length };
    };
    const total = cells.length;
    const done = cells.filter((c) => c.status === 'DONE').length;
    this.progress.set({
      total,
      done,
      pct: total ? Math.round((done / total) * 100) : 0,
      spandrel: count('SPANDREL'),
      unit: count('UNIT'),
    });
  }

  isWindowTypeCode(value: string): boolean {
    return /^\d{2}-\d-\d{2}[A-Z]?$/.test(value.trim());
  }

  stationIcon(stationId: number): string {
    return stationMatIcon(stationId);
  }

  stationIconFilled(stationId: number): boolean {
    return stationMatIconFilled(stationId);
  }

  stationIconStyle(stationId: number): Record<string, string> {
    const t = stationVisualTokens(null, stationId);
    return { '--elev-station-accent': t.accent };
  }
}
