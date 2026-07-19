import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { NgStyle } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import {
  ProjectOrder,
  WorkCycleStatus,
  WorkerContext,
  WorkerProjectCycle,
} from '../../core/skyflow.models';
import { WorkerProjectSelectionService } from './worker-project-selection.service';
import {
  computeStationProgress,
  formatProgressPercent,
  highVolumeProgressRingPercent,
  isStationUnlockedInChain,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from './station-progress';
import { UiSelectComponent } from '../../shared/ui-select/ui-select.component';
import { UiSelectOption } from '../../shared/ui-select/ui-select.types';
import { UiPopupComponent } from '../../shared/ui-popup/ui-popup.component';
import { StationLabelPipe } from '../../shared/station-label.pipe';
import { MatIconComponent } from '../../shared/mat-icon/mat-icon.component';
import {
  stationDescKey,
  stationDisplayNumber,
  stationVisualModifierClass,
  stationVisualStyle,
} from '../../core/station-presentation';

@Component({
  selector: 'skyflow-worker-hub',
  imports: [
    RouterLink,
    TranslateModule,
    NgStyle,
    UiSelectComponent,
    UiPopupComponent,
    StationLabelPipe,
    MatIconComponent,
  ],
  templateUrl: './worker-hub.component.html',
  styleUrl: './worker-hub.component.scss',
})
export class WorkerHubComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly projectSelection = inject(WorkerProjectSelectionService);

  readonly orders = signal<ProjectOrder[]>([]);

  /** סבבי העבודה (יחידות) של הפרויקט הנבחר — לבורר היחידה. */
  readonly projectCycles = signal<WorkerProjectCycle[]>([]);

  /** פופאפ "לבחירת יחידות אחרות". */
  readonly unitPickerOpen = signal(false);

  /** חיפוש חופשי בבורר היחידות (לפי קוד). */
  readonly unitSearch = signal('');

  /** פילטר סטטוס בבורר היחידות. */
  readonly unitStatusFilter = signal<'ALL' | WorkCycleStatus>('ALL');

  /** סטטוסים אפשריים לצ׳יפים של הפילטר (רק כאלה שקיימים בפרויקט). */
  readonly unitStatusFilters = computed(
    (): { value: 'ALL' | WorkCycleStatus; count: number }[] => {
      const list = this.projectCycles();
      const counts = new Map<WorkCycleStatus, number>();
      for (const c of list) {
        counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
      }
      const order: WorkCycleStatus[] = [
        'IN_PROGRESS',
        'OPEN',
        'RETURNED',
        'COMPLETED',
        'DRAFT',
      ];
      const chips: { value: 'ALL' | WorkCycleStatus; count: number }[] = [
        { value: 'ALL', count: list.length },
      ];
      for (const status of order) {
        const count = counts.get(status);
        if (count) chips.push({ value: status, count });
      }
      return chips;
    },
  );

  /** היחידות המסוננות לפי חיפוש + סטטוס. */
  readonly filteredCycles = computed((): WorkerProjectCycle[] => {
    const term = this.unitSearch().trim().toLowerCase();
    const status = this.unitStatusFilter();
    return this.projectCycles().filter((c) => {
      if (status !== 'ALL' && c.status !== status) return false;
      if (term && !c.code.toLowerCase().includes(term)) return false;
      return true;
    });
  });

  /** היחידה/סבב הנבחר (מהשירות המשותף). */
  readonly selectedCycle = computed((): WorkerProjectCycle | null => {
    const id = this.projectSelection.selectedCycleId();
    const list = this.projectCycles();
    if (!list.length) return null;
    return (id ? list.find((c) => c.cycleId === id) : undefined) ?? null;
  });

  /** אפשרויות לבורר היחידה — קוד החלון + כמות שנותרה מסך הכל. */
  readonly cycleOptions = computed((): UiSelectOption[] =>
    this.projectCycles().map((c) => ({
      value: c.cycleId,
      label: `${c.code} · ${c.targetQty}`,
    })),
  );

  /** מנהלי תחנה — תצוגה בלבד (שם על כרטיס) */
  readonly stationManagers = signal<
    Partial<
      Record<
        number,
        { firstName: string; lastName: string; photoUrl: string | null }
      >
    >
  >({});

  /**
   * שתי תחנות בשורה, לפי סדר הזרימה הפיזי.
   * תחנת לייזר (8) מוצגת מיד לפני ההרכבה (3), ורק כשיש זוויות בייצור פנימי.
   * הסדר: מסורים(1) → CNC(2) → לייזר(8) → הרכבה(3) → הדבקות(4) → פינישים(5) → אריזה(6) → הרכבה באתר(7)
   */
  /** לייזר פעיל = לייזר פנימי עם זוויות בפרויקט (או שהסבב הנבחר עובר בלייזר). */
  readonly laserActive = computed(() => {
    const cycle = this.selectedCycle();
    if (cycle) return cycle.stations.some((s) => s.stationId === 8);
    const laser = this.contextByStation()[8]?.laserStation;
    return !!laser && !laser.externalSupplier && laser.angles.length > 0;
  });

  /**
   * רצף התחנות המוצג. כשנבחרה יחידה — רק התחנות המיועדות לסבב הזה (לפי שרשרת
   * התחנות שלו), בסדר הזרימה הפיזי. אחרת — רצף הפרויקט המלא.
   */
  readonly stationRows = computed((): { id: number }[][] => {
    const flowOrder = [1, 2, 8, 3, 4, 5, 6, 7];
    const cycle = this.selectedCycle();
    let sequence: number[];
    if (cycle) {
      const inChain = new Set(cycle.stations.map((s) => s.stationId));
      sequence = flowOrder.filter((id) => inChain.has(id));
    } else {
      sequence = this.laserActive()
        ? [1, 2, 8, 3, 4, 5, 6, 7]
        : [1, 2, 3, 4, 5, 6, 7];
    }
    const rows: { id: number }[][] = [];
    for (let i = 0; i < sequence.length; i += 2) {
      rows.push(sequence.slice(i, i + 2).map((id) => ({ id })));
    }
    return rows;
  });

  /** מספר התצוגה של תחנה לפי מיקום בזרימה (הלייזר לפני הרכבה, בלי "8"). */
  displayNumber(stationId: number): number {
    return stationDisplayNumber(stationId, this.laserActive());
  }

  /** Worker context לפי הפרויקט הנבחר — מעגלי התקדמות ב־Hub */
  readonly contextByStation = signal<
    Partial<Record<number, WorkerContext>>
  >({});

  readonly progressCircumference = PROGRESS_RING_C;

  /** ממוצע אחוזים על פני התחנות. פר-סבב כשנבחרה יחידה, אחרת פר-פרויקט. */
  readonly averageOverallPercent = computed(() => {
    const cycle = this.selectedCycle();
    if (cycle) {
      const stations = cycle.stations;
      if (!stations.length) return 0;
      const sum = stations.reduce(
        (acc, s) =>
          acc +
          (s.targetQty > 0
            ? Math.min(100, Math.round((s.processedQty / s.targetQty) * 100))
            : 0),
        0,
      );
      return Math.round(sum / stations.length);
    }
    const map = this.contextByStation();
    let sum = 0;
    for (let id = 1; id <= 7; id++) {
      const ctx = map[id];
      sum += ctx ? computeStationProgress(id, ctx).percent : 0;
    }
    return Math.round(sum / 7);
  });

  /** שם ההזמנה הנבחרת — ברירת מחדל הראשונה ברשימה כשאין בחירה תקפה */
  readonly selectedOrder = computed((): ProjectOrder | null => {
    const list = this.orders();
    if (!list.length) return null;
    const id = this.projectSelection.selectedProjectId();
    return (id ? list.find((o) => o.id === id) : undefined) ?? list[0];
  });

  readonly projectOptions = computed((): UiSelectOption[] =>
    this.orders().map((o) => ({ value: o.id, label: o.name })),
  );

  stationDescKeyFor(stationId: number): string {
    return stationDescKey(this.selectedOrder(), stationId);
  }

  stationVisualModifier(stationId: number): string | null {
    return stationVisualModifierClass(this.selectedOrder(), stationId);
  }

  stationCardStyle(stationId: number): Record<string, string> {
    return stationVisualStyle(this.selectedOrder(), stationId);
  }

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        filter(() => {
          const u = this.router.url.split('?')[0];
          return u === '/worker';
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const pid = this.projectSelection.selectedProjectId();
        if (pid) {
          this.loadAllContexts(pid);
          this.loadProjectCycles(pid);
        }
      });

    this.api
      .getStationManagers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => this.stationManagers.set(m),
        error: () => this.stationManagers.set({}),
      });

    this.api
      .getOrders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.orders.set(list);
          this.projectSelection.syncFromOrders(list);
          const pid = this.projectSelection.selectedProjectId();
          if (pid) {
            this.loadAllContexts(pid);
            this.loadProjectCycles(pid);
          } else {
            this.contextByStation.set({});
            this.projectCycles.set([]);
          }
        },
        error: () => {
          this.orders.set([]);
          this.contextByStation.set({});
        },
      });
  }

  onProjectChange(value: string | number | null): void {
    const id = value == null ? '' : String(value);
    if (!id) return;
    this.projectSelection.select(id);
    this.loadAllContexts(id);
    this.loadProjectCycles(id);
  }

  onCycleChange(value: string | number | null): void {
    const id = value == null ? '' : String(value);
    this.projectSelection.selectCycle(id || null);
  }

  openUnitPicker(): void {
    this.unitSearch.set('');
    this.unitStatusFilter.set('ALL');
    this.unitPickerOpen.set(true);
  }

  closeUnitPicker(): void {
    this.unitPickerOpen.set(false);
  }

  chooseUnit(cycleId: string): void {
    this.projectSelection.selectCycle(cycleId);
    this.unitPickerOpen.set(false);
  }

  onUnitSearchInput(value: string): void {
    this.unitSearch.set(value);
  }

  setUnitStatusFilter(value: 'ALL' | WorkCycleStatus): void {
    this.unitStatusFilter.set(value);
  }

  cycleStatusKey(status: string): string {
    return `PLANNING_NEW.CYCLE_STATUS_${status}`;
  }

  /** אחוז התקדמות ממוצע ליחידה בודדת (על פני תחנותיה). */
  cyclePercent(c: WorkerProjectCycle): number {
    const stations = c.stations;
    if (!stations.length) return 0;
    const sum = stations.reduce(
      (acc, s) =>
        acc +
        (s.targetQty > 0
          ? Math.min(100, Math.round((s.processedQty / s.targetQty) * 100))
          : 0),
      0,
    );
    return Math.round(sum / stations.length);
  }

  /** מספר התחנות שהושלמו ביחידה. */
  cycleDoneStations(c: WorkerProjectCycle): number {
    return c.stations.filter((s) => s.status === 'DONE').length;
  }

  /** טוען את יחידות הפרויקט ובוחר אוטומטית את הראשונה אם אין בחירה תקפה. */
  private loadProjectCycles(projectId: string): void {
    this.api
      .getProjectWorkCycles(projectId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycles) => {
          this.projectCycles.set(cycles);
          const cur = this.projectSelection.selectedCycleId();
          const stillValid = cur && cycles.some((c) => c.cycleId === cur);
          if (!stillValid) {
            this.projectSelection.selectCycle(
              cycles.length ? cycles[0].cycleId : null,
            );
          }
        },
        error: () => this.projectCycles.set([]),
      });
  }

  private loadAllContexts(projectId: string): void {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    forkJoin(
      ids.map((id) =>
        this.api.getWorkerContext(id, projectId).pipe(
          catchError(() => of(null)),
        ),
      ),
    ).subscribe((results) => {
      const map: Partial<Record<number, WorkerContext>> = {};
      results.forEach((ctx, idx) => {
        const stationId = ids[idx];
        if (ctx) {
          map[stationId] = ctx;
        }
      });
      this.contextByStation.set(map);
    });
  }

  hubProgress(stationId: number): StationProgressVm {
    const cycle = this.selectedCycle();
    if (cycle) {
      const st = cycle.stations.find((s) => s.stationId === stationId);
      const target = st?.targetQty ?? 0;
      const done = st?.processedQty ?? 0;
      return {
        done,
        target,
        remaining: Math.max(0, target - done),
        percent:
          target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0,
        noUpstreamTarget: false,
      };
    }
    const ctx = this.contextByStation()[stationId];
    if (!ctx) {
      return {
        done: 0,
        target: 0,
        remaining: 0,
        percent: 0,
        noUpstreamTarget: false,
      };
    }
    return computeStationProgress(stationId, ctx);
  }

  hubProgressLabel(stationId: number, percent: number): string {
    return stationId === 8 ? formatProgressPercent(percent) : String(percent);
  }

  hubProgressRingPercent(stationId: number, prog: StationProgressVm): number {
    return stationId === 8
      ? highVolumeProgressRingPercent(prog.percent, prog.done)
      : prog.percent;
  }

  /** תחנה 1 אחרי אישור תכנון; CNC אחרי דיווח מסורים אחד; תחנות 3+ אחרי 100% בתחנה הקודמת. */
  stationUnlocked(stationId: number): boolean {
    const cycle = this.selectedCycle();
    if (
      cycle &&
      cycle.status !== 'DRAFT' &&
      cycle.stations.some((station) => station.stationId === stationId)
    ) {
      return true;
    }
    return isStationUnlockedInChain(stationId, this.contextByStation());
  }

  stationRouterLink(stationId: number): (string | number)[] | null {
    return this.stationUnlocked(stationId) ? ['/worker', stationId] : null;
  }

  progressDashOffset(percent: number): number {
    return ringStrokeDashOffset(percent);
  }
}
