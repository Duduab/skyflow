import { NgClass } from '@angular/common';
import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, take } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { CurrentUserService } from '../../core/current-user.service';
import {
  ElevationCellDto,
  ElevationFacadeOptionDto,
  ElevationMapResponse,
  ElevationProgressDto,
} from '../../core/skyflow.models';
import { UiButtonComponent } from '../../shared/ui-button.component';

@Component({
  selector: 'skyflow-elevation-map',
  standalone: true,
  imports: [NgClass, RouterLink, TranslateModule, UiButtonComponent],
  templateUrl: './elevation-map.component.html',
  styleUrl: './elevation-map.component.scss',
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
    const ff = this.floorFilter();
    const wt = this.windowTypeFilter();
    const sec = this.activeSection();
    return this.cells().filter((c) => {
      if (c.pageIndex !== pi) return false;
      if (ff && c.floor !== ff) return false;
      if (wt && (c.windowTypeCode ?? '') !== wt) return false;
      if (sec) {
        const cx = c.bbox.x + c.bbox.w / 2;
        if (cx < sec.x0 || cx >= sec.x1) return false;
      }
      return true;
    });
  });

  readonly selectedCount = computed(() => this.selectedIds().size);

  ngOnInit(): void {
    // Embedded (popup) mode — use the provided project + group, no routing.
    const embedded = this.embeddedProjectId();
    if (embedded) {
      this.projectId.set(embedded);
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
    this.load();
  }

  /** Switch to another facade group's map (per-group elevation flow). */
  selectFacade(groupKey: string): void {
    if (this.selectedFacadeGroup() === groupKey) return;
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
          this.facades.set(res.facades ?? []);
          this.selectedFacadeGroup.set(res.selectedFacadeGroup ?? null);
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

  /** לחיצה על מלבן חלון — פותחת את חלון סבב העבודה. */
  onCellClick(cell: ElevationCellDto): void {
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
    for (const c of this.visibleCells()) next.add(c.id);
    this.selectedIds.set(next);
  }

  setFloor(floor: string): void {
    this.floorFilter.set(floor);
  }

  setWindowType(code: string): void {
    this.windowTypeFilter.set(code);
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

  /** כפתור "הושלם" — מסמן את היחידה כבוצעה (ירוק) או מבטל. */
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
}
