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
import { ProjectOrder, WorkerContext } from '../../core/skyflow.models';
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
import { StationLabelPipe } from '../../shared/station-label.pipe';
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
    StationLabelPipe,
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
  /** לייזר פעיל = לייזר פנימי עם זוויות בפרויקט. */
  readonly laserActive = computed(() => {
    const laser = this.contextByStation()[8]?.laserStation;
    return !!laser && !laser.externalSupplier && laser.angles.length > 0;
  });

  readonly stationRows = computed((): { id: number }[][] => {
    const sequence = this.laserActive()
      ? [1, 2, 8, 3, 4, 5, 6, 7]
      : [1, 2, 3, 4, 5, 6, 7];
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

  /** ממוצע אחוזים של כל שבע התחנות (עמדה בלי נתונים נספרת כ־0%). */
  readonly averageOverallPercent = computed(() => {
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
        if (pid) this.loadAllContexts(pid);
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
          } else {
            this.contextByStation.set({});
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
    return isStationUnlockedInChain(stationId, this.contextByStation());
  }

  stationRouterLink(stationId: number): (string | number)[] | null {
    return this.stationUnlocked(stationId) ? ['/worker', stationId] : null;
  }

  progressDashOffset(percent: number): number {
    return ringStrokeDashOffset(percent);
  }
}
