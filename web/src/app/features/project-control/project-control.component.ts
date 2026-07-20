import { DatePipe, NgClass } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { CurrentUserService } from '../../core/current-user.service';
import {
  ElevationFacadeOptionDto,
  FacadeDirection,
  PlanningPdfPreviewDto,
  TrackingBeatDto,
  TrackingPhase,
  TrackingResponse,
  TrackingRowDto,
} from '../../core/skyflow.models';
import { ElevationMapComponent } from '../elevation/elevation-map.component';
import { UiButtonComponent } from '../../shared/ui-button.component';
import { UiPopupComponent } from '../../shared/ui-popup/ui-popup.component';

type ControlTab = 'tracking' | 'map' | 'mapping' | 'notes';

const STAGE_COLORS = [
  '#aa9abf',
  '#bccf95',
  '#88add9',
  '#efb789',
  '#d8adac',
  '#bacde3',
  '#c7b8e0',
  '#a5d1c0',
];

@Component({
  selector: 'skyflow-project-control',
  standalone: true,
  imports: [
    NgClass,
    DatePipe,
    FormsModule,
    TranslateModule,
    ElevationMapComponent,
    UiButtonComponent,
    UiPopupComponent,
  ],
  templateUrl: './project-control.component.html',
  styleUrl: './project-control.component.scss',
})
export class ProjectControlComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly currentUser = inject(CurrentUserService);

  readonly projectId = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<TrackingResponse | null>(null);
  readonly activeTab = signal<ControlTab>('tracking');

  /** מנהל אתר / אדמין רשאים לדווח. תפ״י בצפייה בלבד. */
  readonly canReport = computed(
    () => this.currentUser.isAdmin() || this.currentUser.isSiteManager(),
  );

  /* ---- filters ---- */
  readonly filterStage = signal('');
  readonly filterFacade = signal('');
  readonly filterModule = signal('');
  readonly search = signal('');
  readonly hideCompleted = signal(false);

  /* ---- report popup ---- */
  readonly reportRow = signal<TrackingRowDto | null>(null);
  readonly beatPhase = signal<TrackingPhase>('PRODUCTION');
  readonly beatDate = signal(todayIso());
  readonly beatQty = signal<number | null>(null);
  readonly beatNoteId = signal('');
  readonly beatNote = signal('');
  readonly notesDraft = signal('');
  readonly busy = signal(false);

  /* ---- mapping tab ---- */
  readonly preview = signal<PlanningPdfPreviewDto | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);

  readonly rows = computed(() => this.data()?.rows ?? []);

  readonly filteredRows = computed(() => {
    const stage = this.filterStage();
    const facade = this.filterFacade();
    const mod = this.filterModule();
    const q = this.search().trim().toLowerCase();
    const hide = this.hideCompleted();
    return this.rows().filter((r) => {
      if (stage && r.stageCode !== stage) return false;
      if (facade && r.facadeLabel !== facade) return false;
      if (mod && r.moduleCode !== mod) return false;
      if (
        hide &&
        r.production.status === 'DONE' &&
        r.supply.status === 'DONE' &&
        r.install.status === 'DONE'
      )
        return false;
      if (q) {
        const hay = `${r.stageCode} ${r.facadeLabel} ${r.moduleCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  readonly hasActiveFilters = computed(
    () =>
      !!this.filterStage() ||
      !!this.filterFacade() ||
      !!this.filterModule() ||
      !!this.search().trim() ||
      this.hideCompleted(),
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.projectId.set(id);
    if (!id) {
      this.error.set('missing project');
      this.loading.set(false);
      return;
    }
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .getProjectTracking(this.projectId())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.data.set(res);
          this.error.set(null);
        },
        error: (err) => {
          this.error.set(
            err?.status === 403
              ? 'FORBIDDEN'
              : err?.error?.message || 'LOAD_ERROR',
          );
        },
      });
  }

  setTab(tab: ControlTab): void {
    this.activeTab.set(tab);
    if (tab === 'mapping' && !this.preview() && !this.previewLoading()) {
      this.loadPreview();
    }
    if (tab === 'map') {
      this.loadElevationFacades();
    }
  }

  private loadPreview(): void {
    this.previewLoading.set(true);
    this.previewError.set(null);
    this.api
      .getPlanningPdfPreview(this.projectId())
      .pipe(finalize(() => this.previewLoading.set(false)))
      .subscribe({
        next: (p) => {
          this.preview.set(p);
          this.previewError.set(null);
        },
        error: (err) => {
          this.preview.set(null);
          this.previewError.set(
            err?.status === 403
              ? 'FORBIDDEN'
              : err?.status === 404
                ? 'LOAD_ERROR'
                : 'LOAD_ERROR',
          );
        },
      });
  }

  /* ---- facade-map picker (תפ״י-style) + interactive map popup ---- */
  private readonly DIRECTION_ORDER: FacadeDirection[] = [
    'SOUTH',
    'NORTH',
    'WEST',
    'EAST',
  ];

  /** Analyzed elevation maps — same source as the standalone elevation-map page. */
  readonly elevationFacades = signal<ElevationFacadeOptionDto[]>([]);
  readonly elevationMapLoading = signal(false);

  /** קבוצות החזית עם מפה מנותחת, מקובצות לפי כיוון — בורר תצוגת ההתקנה. */
  readonly elevationFacadesByDirection = computed(
    (): { direction: FacadeDirection; groups: ElevationFacadeOptionDto[] }[] => {
      const groups = this.elevationFacades();
      return this.DIRECTION_ORDER.map((direction) => ({
        direction,
        groups: groups.filter((g) => g.direction === direction),
      })).filter((d) => d.groups.length > 0);
    },
  );

  readonly hasFacadeMaps = computed(
    () => this.elevationFacadesByDirection().length > 0,
  );

  private loadElevationFacades(): void {
    const id = this.projectId();
    if (!id || this.elevationMapLoading()) return;
    this.elevationMapLoading.set(true);
    this.api
      .getElevationMap(id)
      .pipe(finalize(() => this.elevationMapLoading.set(false)))
      .subscribe({
        next: (res) => this.elevationFacades.set(res.facades ?? []),
        error: () => this.elevationFacades.set([]),
      });
  }

  directionKey(dir: FacadeDirection): string {
    return `PLANNING_PDF.DIR_${dir}`;
  }

  /** קבוצת החזית שמפתה פתוחה בפופאפ המפה האינטראקטיבית (או null כשסגור). */
  readonly mapModalGroup = signal<string | null>(null);

  openGroupMap(groupKey: string): void {
    if (!this.projectId()) return;
    this.mapModalGroup.set(groupKey);
  }

  /** סגירת הפופאפ + רענון טבלת המעקב כדי לשקף התקנות שדווחו מהמפה. */
  closeGroupMap(): void {
    this.mapModalGroup.set(null);
    this.load();
    this.loadElevationFacades();
  }

  stageColor(code: string): string {
    const idx = code.charCodeAt(0) - 65;
    return STAGE_COLORS[((idx % STAGE_COLORS.length) + STAGE_COLORS.length) %
      STAGE_COLORS.length] ?? STAGE_COLORS[0];
  }

  /* ---- report popup handling ---- */
  openReport(row: TrackingRowDto): void {
    this.reportRow.set(row);
    this.notesDraft.set(row.notes ?? '');
    this.beatPhase.set(this.suggestPhase(row));
    this.beatDate.set(todayIso());
    this.beatQty.set(null);
    this.beatNoteId.set('');
    this.beatNote.set('');
  }

  closeReport(): void {
    this.reportRow.set(null);
  }

  private suggestPhase(row: TrackingRowDto): TrackingPhase {
    if (row.production.status !== 'DONE') return 'PRODUCTION';
    if (row.supply.status !== 'DONE') return 'SUPPLY';
    return 'INSTALL';
  }

  beatsFor(row: TrackingRowDto, phase: TrackingPhase): TrackingBeatDto[] {
    return row.beats.filter((b) => b.phase === phase);
  }

  readonly maxBeatQty = computed(() => {
    const row = this.reportRow();
    if (!row) return 0;
    const phase = this.beatPhase();
    const state =
      phase === 'PRODUCTION'
        ? row.production
        : phase === 'SUPPLY'
          ? row.supply
          : row.install;
    return state.remaining;
  });

  submitBeat(): void {
    const row = this.reportRow();
    const qty = this.beatQty();
    if (!row || !qty || qty <= 0 || this.busy() || !this.canReport()) return;
    this.busy.set(true);
    this.api
      .addTrackingBeat(this.projectId(), row.id, {
        phase: this.beatPhase(),
        occurredOn: this.beatDate(),
        qty,
        deliveryNoteId:
          this.beatPhase() === 'SUPPLY' && this.beatNoteId()
            ? this.beatNoteId()
            : null,
        note: this.beatNote().trim() || null,
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (res) => this.applyAndKeepRow(res, row.id),
      });
  }

  deleteBeat(beatId: string): void {
    const row = this.reportRow();
    if (!row || this.busy() || !this.canReport()) return;
    this.busy.set(true);
    this.api
      .deleteTrackingBeat(this.projectId(), beatId)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (res) => this.applyAndKeepRow(res, row.id),
      });
  }

  saveNotes(): void {
    const row = this.reportRow();
    if (!row || this.busy() || !this.canReport()) return;
    this.busy.set(true);
    this.api
      .updateTrackingRowNotes(this.projectId(), row.id, this.notesDraft())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (res) => this.applyAndKeepRow(res, row.id),
      });
  }

  private applyAndKeepRow(res: TrackingResponse, rowId: string): void {
    this.data.set(res);
    const next = res.rows.find((r) => r.id === rowId) ?? null;
    this.reportRow.set(next);
    this.beatQty.set(null);
    this.beatNote.set('');
    this.beatNoteId.set('');
  }

  regenerate(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api
      .regenerateProjectTracking(this.projectId())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({ next: (res) => this.data.set(res) });
  }

  clearFilters(): void {
    this.filterStage.set('');
    this.filterFacade.set('');
    this.filterModule.set('');
    this.search.set('');
    this.hideCompleted.set(false);
  }

  goBack(): void {
    void this.router.navigateByUrl(
      this.currentUser.isFloorStaffRole() ? '/worker' : '/admin/projects',
    );
  }

  /** מיפוי סטטוס → מפתח i18n לפי שלב. */
  statusKey(phase: TrackingPhase, status: string): string {
    return `PROJECT_CONTROL.STATUS.${phase}_${status}`;
  }
}

function todayIso(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}
