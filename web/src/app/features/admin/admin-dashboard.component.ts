import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartDataset, ChartType } from 'chart.js';
import { Subject } from 'rxjs';
import { finalize, switchMap, take } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import {
  AdminDashboard,
  ProjectOrder,
  ShippingResponse,
} from '../../core/skyflow.models';
import { loadOrderPickerPreviews } from '../../shared/order-picker-modal/order-picker-preview.loader';
import { OrderPickerModalComponent } from '../../shared/order-picker-modal/order-picker-modal.component';
import { OrderPickerPreview } from '../../shared/order-picker-modal/order-picker.types';
import { LanguageService } from '../../core/language.service';
import {
  enhanceAdminBarDataset,
  enhanceAdminDoughnutDataset,
  enhanceAdminLineDataset,
} from './admin-chart-style.util';

@Component({
  selector: 'skyflow-admin-dashboard',
  imports: [
    TranslateModule,
    BaseChartDirective,
    DatePipe,
    OrderPickerModalComponent,
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly lang = inject(LanguageService);
  private readonly reload$ = new Subject<void>();

  /** First response: default project = first in list (if user didn’t pick "all"). */
  private firstDashboardLoad = true;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminDashboard | null>(null);
  readonly shipping = signal<ShippingResponse | null>(null);
  readonly selectedProjectId = signal<string | null>(null);

  readonly adminOrdersModalOpen = signal(false);
  readonly adminOrderPreviews = signal<Map<string, OrderPickerPreview>>(
    new Map(),
  );
  readonly loadingAdminOrderPreviews = signal(false);

  readonly projectsAsOrders = computed((): ProjectOrder[] => {
    const d = this.data();
    if (!d?.projects?.length) return [];
    return d.projects.map((o) => ({
      id: o.id,
      name: o.name,
      totalItems: o.totalItems,
      requirements: '',
      status: o.status,
      flowStatus: o.flowStatus ?? 'IN_PRODUCTION',
      originalLength: '',
    }));
  });

  readonly lineType = signal<ChartType>('line');
  readonly barType = signal<ChartType>('bar');
  readonly doughnutType = signal<'doughnut'>('doughnut');

  readonly lineChartData = signal<ChartData>({
    labels: [],
    datasets: [],
  });

  readonly barChartData = signal<ChartData>({
    labels: [],
    datasets: [],
  });

  readonly statusChartData = signal<ChartData<'doughnut'>>({
    labels: [],
    datasets: [],
  });

  readonly chartOptions =
    signal<ChartConfiguration['options']>(this.lineBarOptions());
  readonly doughnutOptions = signal<ChartConfiguration<'doughnut'>['options']>(
    this.doughnutChartOptions(),
  );

  ngOnInit(): void {
    this.reload$
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          const pid = this.selectedProjectId();
          return this.api.getAdminDashboard(pid).pipe(
            finalize(() => this.loading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (d) => {
          this.error.set(null);
          this.applyDashboard(d);
        },
        error: () => {
          this.error.set('Unable to load dashboard. Is the API running?');
        },
      });

    this.reload$.next();

    this.api
      .getShippingReady()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.shipping.set(s),
        error: () => this.shipping.set({ rows: [] }),
      });
  }

  onAdminOrderPicked(projectId: string | null): void {
    this.selectedProjectId.set(projectId);
    this.closeAdminOrdersModal();
    this.reload$.next();
  }

  openAdminOrdersModal(): void {
    this.adminOrdersModalOpen.set(true);
    this.refreshAdminOrderPreviews();
  }

  closeAdminOrdersModal(): void {
    this.adminOrdersModalOpen.set(false);
  }

  adminFilterSummary(d: AdminDashboard): string {
    const id = this.selectedProjectId();
    if (!id) {
      return this.translate.instant('ADMIN_PAGE.ALL_PROJECTS');
    }
    return d.projects.find((x) => x.id === id)?.name ?? id;
  }

  private refreshAdminOrderPreviews(): void {
    const orders = this.projectsAsOrders();
    if (!orders.length) {
      this.adminOrderPreviews.set(new Map());
      return;
    }
    this.loadingAdminOrderPreviews.set(true);
    loadOrderPickerPreviews(this.api, orders)
      .pipe(
        take(1),
        finalize(() => this.loadingAdminOrderPreviews.set(false)),
      )
      .subscribe({
        next: (m) => this.adminOrderPreviews.set(m),
        error: () => this.loadingAdminOrderPreviews.set(false),
      });
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  onProjectFilterChange(value: string): void {
    this.selectedProjectId.set(value || null);
    this.reload$.next();
  }

  exportDashboardCsv(d: AdminDashboard): void {
    const lines: string[][] = [
      ['metric', 'value'],
      ['activeProjects', String(d.summary.activeOrders)],
      ['totalOrders', String(d.summary.totalOrders)],
      ['processedVolume', String(d.summary.processedVolume)],
      ['stationLogEntries', String(d.summary.stationLogEntries)],
      ['scrapUnits', String(d.summary.scrapUnits)],
      [
        'scrapRatePct',
        d.summary.scrapRatePct != null ? String(d.summary.scrapRatePct) : '',
      ],
      ['lastActivityAt', d.summary.lastActivityAt ?? ''],
      ['scope', d.summary.scope],
    ];
    const esc = (s: string) =>
      /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const body = lines.map((row) => row.map(esc).join(',')).join('\n');
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyflow-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private applyDashboard(d: AdminDashboard): void {
    this.data.set(d);
    if (
      this.firstDashboardLoad &&
      d.projects.length &&
      this.selectedProjectId() == null
    ) {
      this.firstDashboardLoad = false;
      this.selectedProjectId.set(d.projects[0].id);
      queueMicrotask(() => this.reload$.next());
      return;
    }
    this.firstDashboardLoad = false;

    const loc = this.dateLocale();
    const dayLabels = d.charts.dailyProgress.labels.map((iso) => {
      const dt = new Date(`${iso}T12:00:00Z`);
      return dt.toLocaleDateString(loc, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    });

    this.lineChartData.set({
      labels: dayLabels,
      datasets: d.charts.dailyProgress.datasets.map((ds) =>
        enhanceAdminLineDataset(ds as ChartDataset<'line', number[]>),
      ),
    });

    this.barChartData.set({
      labels: d.charts.stationLoad.labels,
      datasets: d.charts.stationLoad.datasets.map((ds) =>
        enhanceAdminBarDataset(ds as ChartDataset<'bar', number[]>),
      ),
    });

    const mix = d.charts.statusMix;
    if (mix?.labels?.length) {
      const statusLabels = mix.labels.map((s) =>
        this.translate.instant(`ORDER_STATUS.${s}`),
      );
      this.statusChartData.set({
        labels: statusLabels,
        datasets: mix.datasets.map((ds) =>
          enhanceAdminDoughnutDataset(
            ds as ChartDataset<'doughnut', number[]>,
          ),
        ) as ChartData<'doughnut'>['datasets'],
      });
    } else {
      this.statusChartData.set({ labels: [], datasets: [] });
    }
  }

  private lineBarOptions(): ChartConfiguration['options'] {
    const axisColor = '#e8eef7';
    const grid = 'rgba(255,255,255,0.06)';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      animations: {
        colors: {
          type: 'color',
          duration: 900,
          easing: 'easeOutQuart',
        },
        numbers: {
          type: 'number',
          duration: 950,
          easing: 'easeOutCubic',
        },
      },
      plugins: {
        legend: {
          labels: {
            color: '#ffffff',
            font: { size: 15, weight: 600 },
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 18,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          titleFont: { size: 14, weight: 600 },
          bodyFont: { size: 14 },
          padding: 12,
          cornerRadius: 12,
          borderColor: 'rgba(85, 143, 195, 0.45)',
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: axisColor, font: { size: 13 } },
          grid: { color: grid },
          border: {
            display: true,
            color: 'rgba(255,255,255,0.14)',
          },
        },
        y: {
          beginAtZero: true,
          ticks: { color: axisColor, font: { size: 13 } },
          grid: { color: grid },
          border: {
            display: true,
            color: 'rgba(255,255,255,0.14)',
          },
        },
      },
    };
  }

  private doughnutChartOptions(): ChartConfiguration<'doughnut'>['options'] {
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '54%',
      rotation: -Math.PI / 2,
      circumference: 2 * Math.PI,
      interaction: {
        mode: 'nearest',
        intersect: true,
      },
      animations: {
        colors: {
          type: 'color',
          duration: 1000,
          easing: 'easeOutQuart',
        },
        numbers: {
          type: 'number',
          duration: 1050,
          easing: 'easeOutCubic',
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#ffffff',
            font: { size: 14, weight: 600 },
            padding: 18,
            usePointStyle: true,
            pointStyle: 'rectRounded',
            boxWidth: 14,
            boxHeight: 14,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          titleFont: { size: 14, weight: 600 },
          bodyFont: { size: 14 },
          padding: 12,
          cornerRadius: 12,
          borderColor: 'rgba(85, 143, 195, 0.45)',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              const total = (ctx.dataset.data as number[]).reduce(
                (a, b) => a + b,
                0,
              );
              const v = Number(ctx.raw) || 0;
              const pct =
                total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
              return ` ${ctx.label}: ${v} (${pct}%)`;
            },
          },
        },
      },
    };
  }
}
