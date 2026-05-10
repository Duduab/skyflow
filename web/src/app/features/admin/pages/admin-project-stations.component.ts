import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, take } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import { ProjectOrder, WorkerContext } from '../../../core/skyflow.models';
import { WorkerProjectSelectionService } from '../../worker/worker-project-selection.service';
import {
  computeStationProgress,
  isStationUnlockedInChain,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from '../../worker/station-progress';
import { StationsLoaderComponent } from '../../../shared/stations-loader/stations-loader.component';

@Component({
  selector: 'skyflow-admin-project-stations',
  imports: [RouterLink, TranslateModule, StationsLoaderComponent],
  templateUrl: './admin-project-stations.component.html',
  styleUrls: ['./admin-project-stations.component.scss', '../../worker/worker-hub.component.scss'],
})
export class AdminProjectStationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly projectSelection = inject(WorkerProjectSelectionService);

  readonly orders = signal<ProjectOrder[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
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

  readonly canCompleteProject = signal(false);
  readonly completingProject = signal(false);
  readonly completeError = signal<string | null>(null);

  readonly stationRows: { id: number }[][] = [
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }, { id: 4 }],
    [{ id: 5 }, { id: 6 }],
    [{ id: 7 }],
  ];

  readonly progressCircumference = PROGRESS_RING_C;

  readonly averageOverallPercent = computed(() => {
    const map = this.contextByStation();
    let sum = 0;
    for (let id = 1; id <= 7; id++) {
      const ctx = map[id];
      sum += ctx ? computeStationProgress(id, ctx).percent : 0;
    }
    return Math.round(sum / 7);
  });

  readonly projectDisplayName = computed(() => {
    const pid = this.projectSelection.selectedProjectId();
    const list = this.orders();
    if (!pid || !list.length) return '';
    return list.find((o) => o.id === pid)?.name ?? '';
  });

  ngOnInit(): void {
    this.api
      .getStationManagers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => this.stationManagers.set(m),
        error: () => this.stationManagers.set({}),
      });

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        const id = pm.get('projectId');
        if (!id) {
          void this.router.navigate(['/admin/projects']);
          return;
        }
        this.projectSelection.select(id);
        this.loadOrdersAndContexts(id);
      });
  }

  private loadOrdersAndContexts(projectId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getOrders()
      .pipe(take(1), finalize(() => {}))
      .subscribe({
        next: (list) => {
          this.orders.set(list);
          this.projectSelection.syncFromOrders(list);
          this.projectSelection.select(projectId);
          this.loadAllContexts(projectId);
        },
        error: () => {
          this.error.set('לא ניתן לטעון פרויקטים');
          this.loading.set(false);
        },
      });
  }

  private loadAllContexts(projectId: string): void {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    forkJoin(
      ids.map((id) =>
        this.api.getWorkerContext(id, projectId).pipe(
          catchError(() => of(null)),
        ),
      ),
    )
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe((results) => {
        const map: Partial<Record<number, WorkerContext>> = {};
        results.forEach((ctx, idx) => {
          const stationId = ids[idx];
          if (ctx) map[stationId] = ctx;
        });
        this.contextByStation.set(map);
        this.refreshCompleteState(projectId);
      });
  }

  private refreshCompleteState(projectId: string): void {
    this.api
      .getCanComplete(projectId)
      .pipe(take(1))
      .subscribe({
        next: (r) => this.canCompleteProject.set(r.canComplete),
        error: () => this.canCompleteProject.set(false),
      });
  }

  completeProject(): void {
    const pid = this.projectSelection.selectedProjectId();
    if (!pid) return;
    this.completingProject.set(true);
    this.completeError.set(null);
    this.api
      .postCompleteProject(pid)
      .pipe(
        take(1),
        finalize(() => this.completingProject.set(false)),
      )
      .subscribe({
        next: () => this.loadOrdersAndContexts(pid),
        error: () =>
          this.completeError.set(
            'לא ניתן לסגור פרויקט — ודאו שכל התחנות ב־100%',
          ),
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
