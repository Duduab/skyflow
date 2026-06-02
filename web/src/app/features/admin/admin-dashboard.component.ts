import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartDataset, ChartType } from 'chart.js';
import * as XLSX from 'xlsx';
import { Subject } from 'rxjs';
import { finalize, switchMap } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import {
  AdminDashboard,
  AdminProjectRow,
  ShippingResponse,
} from '../../core/skyflow.models';
import { LanguageService } from '../../core/language.service';
import { ThemeService } from '../../core/theme.service';
import { MatIconComponent } from '../../shared/mat-icon/mat-icon.component';
import { UiButtonComponent } from '../../shared/ui-button.component';
import { CountUpDirective } from '../../shared/count-up/count-up.directive';
import { UiSelectComponent } from '../../shared/ui-select/ui-select.component';
import { UiSelectOption } from '../../shared/ui-select/ui-select.types';
import {
  enhanceAdminBarDataset,
  enhanceAdminDoughnutDataset,
  enhanceAdminLineDataset,
} from './admin-chart-style.util';
import {
  buildAdminDashboardWorkbook,
  dashboardExportFileName,
  hebrewDashboardExportTr,
} from './admin-dashboard-export.util';

const LIVE_CAROUSEL_PAGE_SIZE = 3;

@Component({
  selector: 'skyflow-admin-dashboard',
  imports: [
    TranslateModule,
    BaseChartDirective,
    DatePipe,
    RouterLink,
    MatIconComponent,
    UiButtonComponent,
    CountUpDirective,
    UiSelectComponent,
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly lang = inject(LanguageService);
  private readonly theme = inject(ThemeService);
  private readonly reload$ = new Subject<void>();

  /** First response: default project = first in list (if user didn’t pick "all"). */
  private firstDashboardLoad = true;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminDashboard | null>(null);
  readonly shipping = signal<ShippingResponse | null>(null);
  readonly selectedProjectId = signal<string | null>(null);

  /** טבלת פרויקטים בדשבורד — עימוד */
  readonly projectsPageSize = 10;
  readonly projectsPageIndex = signal(0);
  readonly liveCarouselIndex = signal(0);
  readonly liveCarouselPageSize = LIVE_CAROUSEL_PAGE_SIZE;
  readonly liveCarouselSliding = signal(false);

  readonly exportCsvLoading = signal(false);
  readonly exportCsvToastVisible = signal(false);
  private exportCsvToastTimer: ReturnType<typeof setTimeout> | null = null;

  /** פרויקטים בעמוד הנוכחי (טבלת דשבורד) */
  readonly pagedProjectsList = computed(() => {
    const d = this.data();
    if (!d?.projects?.length) return [];
    const total = d.projects.length;
    const size = this.projectsPageSize;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(this.projectsPageIndex(), totalPages - 1);
    const start = page * size;
    return d.projects.slice(start, start + size);
  });

  /** מטא־עימוד לטבלת פרויקטים */
  readonly projectsPagerMeta = computed(() => {
    const d = this.data();
    const total = d?.projects?.length ?? 0;
    const size = this.projectsPageSize;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(this.projectsPageIndex(), totalPages - 1);
    const start = page * size;
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(total, start + size);
    return {
      total,
      totalPages,
      page: page + 1,
      from,
      to,
      showPager: total > size,
    };
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

  private readonly chartRefs = viewChildren(BaseChartDirective);

  readonly chartOptions = computed<ChartConfiguration['options']>(() => {
    const light = this.theme.mode() === 'light';
    const lineMax = maxDatasetValue(this.lineChartData());
    const barMax = maxDatasetValue(this.barChartData());
    const suggestedMax = Math.max(lineMax, barMax) === 0 ? 8 : undefined;
    return this.lineBarOptions(light, suggestedMax);
  });
  readonly doughnutOptions = computed<
    ChartConfiguration<'doughnut'>['options']
  >(() => this.doughnutChartOptions(this.theme.mode() === 'light'));

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.exportCsvToastTimer) {
        clearTimeout(this.exportCsvToastTimer);
      }
    });

    effect(() => {
      const d = this.data();
      this.lang.current();
      this.theme.mode();
      if (!d?.charts) return;
      this.syncChartsFromDashboard(d);
      queueMicrotask(() => this.refreshCharts());
    });
  }

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

  adminFilterSummary(d: AdminDashboard): string {
    const id = this.selectedProjectId();
    if (!id) {
      return this.translate.instant('ADMIN_PAGE.ALL_PROJECTS');
    }
    return d.projects.find((x) => x.id === id)?.name ?? id;
  }

  projectFilterOptions(d: AdminDashboard): UiSelectOption[] {
    return [
      { value: '', label: this.translate.instant('ADMIN_PAGE.ALL_PROJECTS') },
      ...d.projects.map((p) => ({ value: p.id, label: p.name })),
    ];
  }

  liveProjects(d: AdminDashboard): AdminProjectRow[] {
    return d.projects.filter((p) => p.liveViewAvailable);
  }

  liveCarouselCanPrev(): boolean {
    return this.liveCarouselIndex() > 0;
  }

  liveCarouselCanNext(d: AdminDashboard): boolean {
    const total = this.liveProjects(d).length;
    return this.liveCarouselIndex() + LIVE_CAROUSEL_PAGE_SIZE < total;
  }

  liveCarouselPrev(): void {
    if (!this.liveCarouselCanPrev()) return;
    this.liveCarouselSliding.set(true);
    this.liveCarouselIndex.update((i) => Math.max(0, i - 1));
  }

  liveCarouselNext(d: AdminDashboard): void {
    if (!this.liveCarouselCanNext(d)) return;
    const maxStart = Math.max(0, this.liveProjects(d).length - LIVE_CAROUSEL_PAGE_SIZE);
    this.liveCarouselSliding.set(true);
    this.liveCarouselIndex.update((i) => Math.min(maxStart, i + 1));
  }

  private resetLiveCarousel(): void {
    this.liveCarouselIndex.set(0);
    this.liveCarouselSliding.set(false);
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  onProjectFilterChange(value: string | number | null): void {
    const v = value == null ? '' : String(value);
    this.selectedProjectId.set(v || null);
    this.projectsPageIndex.set(0);
    this.resetLiveCarousel();
    this.reload$.next();
  }

  prevProjectsPage(): void {
    this.projectsPageIndex.update((i) => Math.max(0, i - 1));
  }

  nextProjectsPage(): void {
    const meta = this.projectsPagerMeta();
    if (!meta.showPager) return;
    this.projectsPageIndex.update((i) => Math.min(meta.totalPages - 1, i + 1));
  }

  exportDashboardCsv(d: AdminDashboard): void {
    if (this.exportCsvLoading()) return;
    this.exportCsvLoading.set(true);
    const started = performance.now();
    const filterLabel = this.adminFilterSummary(d);

    try {
      const tr = hebrewDashboardExportTr;
      const wb = buildAdminDashboardWorkbook(
        d,
        this.shipping(),
        filterLabel,
        tr,
      );
      XLSX.writeFile(wb, dashboardExportFileName(d, filterLabel));
    } finally {
      const elapsed = performance.now() - started;
      const wait = Math.max(0, 450 - elapsed);
      setTimeout(() => {
        this.exportCsvLoading.set(false);
        this.showExportCsvToast();
      }, wait);
    }
  }

  private showExportCsvToast(): void {
    if (this.exportCsvToastTimer) {
      clearTimeout(this.exportCsvToastTimer);
    }
    this.exportCsvToastVisible.set(true);
    this.exportCsvToastTimer = setTimeout(() => {
      this.exportCsvToastVisible.set(false);
      this.exportCsvToastTimer = null;
    }, 3200);
  }

  private applyDashboard(d: AdminDashboard): void {
    this.data.set(d);
    const liveTotal = d.projects.filter((p) => p.liveViewAvailable).length;
    const liveMaxStart = Math.max(0, liveTotal - LIVE_CAROUSEL_PAGE_SIZE);
    if (this.liveCarouselIndex() > liveMaxStart) {
      this.liveCarouselIndex.set(liveMaxStart);
    }
    const pages = Math.max(1, Math.ceil(d.projects.length / this.projectsPageSize));
    if (this.projectsPageIndex() >= pages) {
      this.projectsPageIndex.set(Math.max(0, pages - 1));
    }
    this.syncChartsFromDashboard(d);

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

    queueMicrotask(() => this.refreshCharts());
  }

  private syncChartsFromDashboard(d: AdminDashboard): void {
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

  private refreshCharts(): void {
    for (const chart of this.chartRefs()) {
      chart.update();
    }
  }

  private lineBarOptions(
    themeLight: boolean,
    suggestedMax?: number,
  ): ChartConfiguration['options'] {
    const axisColor = themeLight ? '#334155' : '#e8eef7';
    const grid = themeLight
      ? 'rgba(15, 23, 42, 0.08)'
      : 'rgba(255,255,255,0.06)';
    const legendColor = themeLight ? '#0f172a' : '#ffffff';
    const borderMuted = themeLight
      ? 'rgba(15, 23, 42, 0.14)'
      : 'rgba(255,255,255,0.14)';
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
            color: legendColor,
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
            color: borderMuted,
          },
        },
        y: {
          beginAtZero: true,
          ...(suggestedMax != null ? { suggestedMax } : {}),
          ticks: { color: axisColor, font: { size: 13 } },
          grid: { color: grid },
          border: {
            display: true,
            color: borderMuted,
          },
        },
      },
    };
  }

  private doughnutChartOptions(
    themeLight: boolean,
  ): ChartConfiguration<'doughnut'>['options'] {
    const legendColor = themeLight ? '#0f172a' : '#ffffff';
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
            color: legendColor,
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

function maxDatasetValue(chart: ChartData): number {
  let max = 0;
  for (const ds of chart.datasets ?? []) {
    const data = ds.data as number[] | undefined;
    if (!data?.length) continue;
    for (const v of data) {
      if (typeof v === 'number' && v > max) max = v;
    }
  }
  return max;
}
