import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe, NgStyle } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin, of, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '../../../core/api.service';
import { WorkerContext } from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';
import { visibilityAwareInterval } from '../../../core/visibility-aware-interval';
import {
  computeStationProgress,
  isStationUnlockedInChain,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from '../../worker/station-progress';
import { StationsLoaderComponent } from '../../../shared/stations-loader/stations-loader.component';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { StationLabelPipe } from '../../../shared/station-label.pipe';
import {
  stationDescKey,
  stationVisualModifierClass,
  stationVisualStyle,
} from '../../../core/station-presentation';

@Component({
  selector: 'skyflow-admin-project-live',
  imports: [
    TranslateModule,
    DatePipe,
    NgStyle,
    StationsLoaderComponent,
    UiButtonComponent,
    StationLabelPipe,
  ],
  templateUrl: './admin-project-live.component.html',
  styleUrls: [
    './admin-project-live.component.scss',
    '../../worker/worker-hub.component.scss',
  ],
})
export class AdminProjectLiveComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lang = inject(LanguageService);

  readonly pollMs = 5000;

  readonly loading = signal(true);
  readonly refreshError = signal(false);
  readonly lastRefresh = signal<Date | null>(null);
  readonly contextByStation = signal<
    Partial<Record<number, WorkerContext>>
  >({});
  readonly stationManagers = signal<
    Partial<
      Record<
        number,
        { firstName: string; lastName: string; photoUrl: string | null }
      >
    >
  >({});

  readonly stationRows: { id: number }[][] = [
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }, { id: 4 }],
    [{ id: 5 }, { id: 6 }],
    [{ id: 7 }],
  ];

  readonly progressCircumference = PROGRESS_RING_C;

  readonly variantOrder = computed(
    () => this.contextByStation()[1]?.order ?? null,
  );

  readonly projectName = computed(
    () => this.variantOrder()?.name ?? '',
  );

  stationDescKeyFor(stationId: number): string {
    return stationDescKey(this.variantOrder(), stationId);
  }

  stationVisualModifier(stationId: number): string | null {
    return stationVisualModifierClass(this.variantOrder(), stationId);
  }

  stationCardStyle(stationId: number): Record<string, string> {
    return stationVisualStyle(this.variantOrder(), stationId);
  }

  readonly averageOverallPercent = computed(() => {
    const map = this.contextByStation();
    let sum = 0;
    for (let id = 1; id <= 7; id++) {
      const ctx = map[id];
      sum += ctx ? computeStationProgress(id, ctx).percent : 0;
    }
    return Math.round(sum / 7);
  });

  /** תצוגה חיה מותרת רק כשהפרויקט בביצוע ויש דיווח בתחנה 1 */
  readonly accessDenied = computed(() => {
    if (this.loading()) return false;
    const c = this.contextByStation()[1];
    if (!c) return false;
    const q1 = c.totals?.find((t) => t.stationId === 1)?.processedQty ?? 0;
    const flow = c.order.flowStatus ?? 'IN_PRODUCTION';
    return (
      q1 < 1 ||
      c.order.status !== 'IN_PROGRESS' ||
      flow !== 'IN_PRODUCTION'
    );
  });

  readonly loadProblem = computed(
    () => !this.loading() && !this.contextByStation()[1],
  );

  ngOnInit(): void {
    this.api
      .getStationManagers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => this.stationManagers.set(m),
        error: () => this.stationManagers.set({}),
      });

    this.route.paramMap
      .pipe(
        map((p) => p.get('projectId')),
        tap((pid) => {
          if (!pid) void this.router.navigate(['/admin/projects']);
        }),
        filter((id): id is string => !!id),
        distinctUntilChanged(),
        switchMap((pid) => {
          this.loading.set(true);
          this.contextByStation.set({});
          this.refreshError.set(false);

          let firstPollForProject = true;

          // Pauses while the tab is hidden (Page Visibility API) and catches
          // up immediately when it becomes visible again, instead of hitting
          // 7 worker-context endpoints every 5s whether anyone is watching.
          return visibilityAwareInterval(this.pollMs).pipe(
            switchMap(() => {
              const minUi = firstPollForProject ? timer(400) : of(0);
              firstPollForProject = false;
              return forkJoin([this.fetchContexts(pid), minUi]).pipe(
                tap(() => {
                  this.lastRefresh.set(new Date());
                  this.loading.set(false);
                }),
              );
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: () => {
          this.refreshError.set(true);
          this.loading.set(false);
        },
      });
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  exit(): void {
    void this.router.navigate(['/admin/projects']);
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

  stationUnlocked(stationId: number): boolean {
    return isStationUnlockedInChain(stationId, this.contextByStation());
  }

  progressDashOffset(percent: number): number {
    return ringStrokeDashOffset(percent);
  }

  private fetchContexts(projectId: string) {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    return forkJoin(
      ids.map((id) =>
        this.api.getWorkerContext(id, projectId).pipe(
          catchError(() => of(null)),
        ),
      ),
    ).pipe(
      tap((results) => {
        const map: Partial<Record<number, WorkerContext>> = {};
        let anyOk = false;
        results.forEach((ctx, idx) => {
          if (ctx) {
            anyOk = true;
            map[ids[idx]] = ctx;
          }
        });
        this.contextByStation.set(map);
        this.refreshError.set(!anyOk);
      }),
    );
  }
}
