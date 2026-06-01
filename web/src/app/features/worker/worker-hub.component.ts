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
import { filter } from 'rxjs/operators';
import { NgStyle } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, take } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { ProjectOrder, WorkerContext } from '../../core/skyflow.models';
import { loadOrderPickerPreviews } from '../../shared/order-picker-modal/order-picker-preview.loader';
import { OrderPickerModalComponent } from '../../shared/order-picker-modal/order-picker-modal.component';
import { OrderPickerPreview } from '../../shared/order-picker-modal/order-picker.types';
import { WorkerProjectSelectionService } from './worker-project-selection.service';
import {
  computeStationProgress,
  isStationUnlockedInChain,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from './station-progress';
import { UiButtonComponent } from '../../shared/ui-button.component';
import { StationLabelPipe } from '../../shared/station-label.pipe';
import {
  stationDescKey,
  stationVisualModifierClass,
  stationVisualStyle,
} from '../../core/station-presentation';

/** @deprecated השתמשו ב-OrderPickerPreview; נשאר לתאימות */
export type OrderHubPreview = OrderPickerPreview;

@Component({
  selector: 'skyflow-worker-hub',
  imports: [
    RouterLink,
    TranslateModule,
    NgStyle,
    OrderPickerModalComponent,
    UiButtonComponent,
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

  readonly ordersModalOpen = signal(false);
  readonly orderPreviews = signal<Map<string, OrderPickerPreview>>(new Map());
  readonly loadingOrderPreviews = signal(false);

  /** מנהלי תחנה — תצוגה בלבד (שם על כרטיס) */
  readonly stationManagers = signal<
    Partial<
      Record<
        number,
        { firstName: string; lastName: string; photoUrl: string | null }
      >
    >
  >({});

  /** שתי תחנות בשורה; תחנה 7 (הרכבה באתר) בשורה אחרונה */
  readonly stationRows: { id: number }[][] = [
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }, { id: 4 }],
    [{ id: 5 }, { id: 6 }],
    [{ id: 7 }],
  ];

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

  readonly selectedOrderDisplayName = computed(() => {
    return this.selectedOrder()?.name ?? '';
  });

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

  openOrdersModal(): void {
    this.ordersModalOpen.set(true);
    this.refreshOrderPreviews();
  }

  closeOrdersModal(): void {
    this.ordersModalOpen.set(false);
  }

  onOrderPickedFromModal(projectId: string | null): void {
    if (!projectId) return;
    this.projectSelection.select(projectId);
    this.loadAllContexts(projectId);
    this.closeOrdersModal();
  }

  private refreshOrderPreviews(): void {
    const list = this.orders();
    if (!list.length) {
      this.orderPreviews.set(new Map());
      return;
    }
    this.loadingOrderPreviews.set(true);
    loadOrderPickerPreviews(this.api, list)
      .pipe(
        take(1),
        finalize(() => this.loadingOrderPreviews.set(false)),
      )
      .subscribe({
        next: (m) => this.orderPreviews.set(m),
        error: () => this.loadingOrderPreviews.set(false),
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
