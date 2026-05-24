import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartDataset, ChartType } from 'chart.js';
import * as XLSX from 'xlsx';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import {
  AdminDashboard,
  ScrapOverviewResponse,
  ScrapOverviewRow,
} from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';
import {
  enhanceAdminBarDataset,
  enhanceAdminLineDataset,
} from '../admin-chart-style.util';

export interface ScrapProjectTotalVm {
  projectId: string;
  projectName: string;
  totalScrapCm: number;
  totalPieces: number;
  rowCount: number;
  sharePct: number;
}

export interface ScrapStationTotalVm {
  stationId: number;
  stationName: string;
  totalScrapCm: number;
  totalPieces: number;
}

export interface ScrapDayBucketVm {
  dateKey: string;
  label: string;
  totalScrapCm: number;
  totalPieces: number;
}

function rowScrapCm(r: ScrapOverviewRow): number {
  return r.itemLengthCm * r.scrapQty;
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calendarDayKey(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return localDateKey(d.toISOString());
}

function aggregateScrapByProject(
  rows: ScrapOverviewRow[],
): ScrapProjectTotalVm[] {
  const map = new Map<string, ScrapProjectTotalVm>();
  let grand = 0;
  for (const r of rows) {
    const cm = rowScrapCm(r);
    grand += cm;
    const cur = map.get(r.projectId);
    if (!cur) {
      map.set(r.projectId, {
        projectId: r.projectId,
        projectName: r.projectName,
        totalScrapCm: cm,
        totalPieces: r.scrapQty,
        rowCount: 1,
        sharePct: 0,
      });
    } else {
      cur.totalScrapCm += cm;
      cur.totalPieces += r.scrapQty;
      cur.rowCount += 1;
    }
  }
  const list = Array.from(map.values()).sort(
    (a, b) => b.totalScrapCm - a.totalScrapCm,
  );
  if (grand > 0) {
    for (const p of list) {
      p.sharePct = Math.round((p.totalScrapCm / grand) * 1000) / 10;
    }
  }
  return list;
}

function aggregateScrapByStation(
  rows: ScrapOverviewRow[],
): ScrapStationTotalVm[] {
  const map = new Map<number, ScrapStationTotalVm>();
  for (const r of rows) {
    const cm = rowScrapCm(r);
    const cur = map.get(r.stationId);
    if (!cur) {
      map.set(r.stationId, {
        stationId: r.stationId,
        stationName: r.stationName,
        totalScrapCm: cm,
        totalPieces: r.scrapQty,
      });
    } else {
      cur.totalScrapCm += cm;
      cur.totalPieces += r.scrapQty;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalScrapCm - a.totalScrapCm);
}

function aggregateScrapByDay(
  rows: ScrapOverviewRow[],
  locale: string,
  maxDays: number,
): ScrapDayBucketVm[] {
  const map = new Map<string, ScrapDayBucketVm>();
  for (const r of rows) {
    const key = localDateKey(r.createdAt);
    const cm = rowScrapCm(r);
    const cur = map.get(key);
    if (!cur) {
      const dt = new Date(`${key}T12:00:00`);
      map.set(key, {
        dateKey: key,
        label: dt.toLocaleDateString(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        totalScrapCm: cm,
        totalPieces: r.scrapQty,
      });
    } else {
      cur.totalScrapCm += cm;
      cur.totalPieces += r.scrapQty;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .slice(-maxDays);
}

@Component({
  selector: 'skyflow-admin-scrap',
  imports: [
    TranslateModule,
    DecimalPipe,
    DatePipe,
    RouterLink,
    BaseChartDirective,
  ],
  templateUrl: './admin-scrap.component.html',
  styleUrl: './admin-scrap.component.scss',
})
export class AdminScrapComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lang = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  readonly theme = inject(ThemeService);

  readonly loading = signal(true);
  readonly dashboard = signal<AdminDashboard | null>(null);
  readonly scrapData = signal<ScrapOverviewResponse | null>(null);
  /** null = כל הפרויקטים */
  readonly projectFilter = signal<string | null>(null);

  readonly lineType = signal<ChartType>('line');
  readonly barType = signal<ChartType>('bar');

  readonly dailyChartData = signal<ChartData<'line'>>({
    labels: [],
    datasets: [],
  });
  readonly compareChartData = signal<ChartData<'bar'>>({
    labels: [],
    datasets: [],
  });
  readonly splitChartData = signal<ChartData<'bar'>>({
    labels: [],
    datasets: [],
  });

  readonly chartOptions = computed<ChartConfiguration['options']>(() =>
    this.lineBarOptions(this.theme.mode() === 'light'),
  );

  readonly detailRows = computed(() => this.scrapData()?.rows ?? []);

  readonly projectTotals = computed((): ScrapProjectTotalVm[] => {
    if (this.projectFilter()) return [];
    const rows = this.detailRows();
    if (!rows.length) return [];
    return aggregateScrapByProject(rows);
  });

  readonly stationTotals = computed((): ScrapStationTotalVm[] => {
    const rows = this.detailRows();
    if (!rows.length) return [];
    return aggregateScrapByStation(rows).slice(0, 8);
  });

  readonly metrics = computed(() => {
    const rows = this.detailRows();
    const todayKey = calendarDayKey(0);
    const yesterdayKey = calendarDayKey(-1);

    let totalCm = 0;
    let totalPieces = 0;
    let todayCm = 0;
    let todayPieces = 0;
    let yesterdayCm = 0;
    let yesterdayPieces = 0;

    for (const r of rows) {
      const cm = rowScrapCm(r);
      totalCm += cm;
      totalPieces += r.scrapQty;
      const dk = localDateKey(r.createdAt);
      if (dk === todayKey) {
        todayCm += cm;
        todayPieces += r.scrapQty;
      } else if (dk === yesterdayKey) {
        yesterdayCm += cm;
        yesterdayPieces += r.scrapQty;
      }
    }

    const deltaCm = todayCm - yesterdayCm;
    let deltaPct: number | null = null;
    if (yesterdayCm > 0) {
      deltaPct = Math.round((deltaCm / yesterdayCm) * 1000) / 10;
    } else if (todayCm > 0) {
      deltaPct = null;
    } else {
      deltaPct = 0;
    }

    const dash = this.dashboard();
    const processed = dash?.summary.processedVolume ?? 0;
    const scrapRate = dash?.summary.scrapRatePct ?? null;
    const recoverableHint =
      scrapRate != null && processed > 0
        ? Math.round((totalCm * (100 - scrapRate)) / 100)
        : null;

    return {
      totalCm,
      totalPieces,
      entryCount: rows.length,
      todayCm,
      todayPieces,
      yesterdayCm,
      yesterdayPieces,
      deltaCm,
      deltaPct,
      scrapRate,
      processedVolume: processed,
      recoverableHint,
      todayKey,
      yesterdayKey,
    };
  });

  readonly trendDirection = computed<'better' | 'worse' | 'flat'>(() => {
    const { deltaCm } = this.metrics();
    if (deltaCm < -0.5) return 'better';
    if (deltaCm > 0.5) return 'worse';
    return 'flat';
  });

  readonly scrapFocusedProjectName = computed((): string | null => {
    const id = this.projectFilter();
    if (!id) return null;
    const p = this.dashboard()?.projects.find((x) => x.id === id);
    const fromDash = p?.name?.trim();
    if (fromDash) return fromDash;
    const row = this.scrapData()?.rows.find((r) => r.projectId === id);
    const fromRow = row?.projectName?.trim();
    return fromRow && fromRow.length > 0 ? fromRow : null;
  });

  readonly scopeLabel = computed(() => {
    const name = this.scrapFocusedProjectName();
    if (name) return name;
    return this.translate.instant('ADMIN_SCRAP_PAGE.FILTER_ALL');
  });

  constructor() {
    effect(() => {
      this.detailRows();
      this.lang.current();
      this.theme.mode();
      this.rebuildCharts();
    });
  }

  ngOnInit(): void {
    forkJoin({
      dashboard: this.api.getAdminDashboard(null),
      scrap: this.api.getScrapOverview(null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ dashboard, scrap }) => {
          this.dashboard.set(dashboard);
          this.scrapData.set(scrap);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  rowCm(r: ScrapOverviewRow): number {
    return rowScrapCm(r);
  }

  formatDayLabel(dateKey: string): string {
    const dt = new Date(`${dateKey}T12:00:00`);
    return dt.toLocaleDateString(this.dateLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  filterByProject(projectId: string): void {
    this.onProjectFilterChange(projectId);
  }

  onProjectFilterChange(value: string): void {
    const id = value === '' ? null : value;
    this.projectFilter.set(id);
    this.loading.set(true);

    if (id === null) {
      forkJoin({
        dashboard: this.api.getAdminDashboard(null),
        scrap: this.api.getScrapOverview(null),
      })
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => this.loading.set(false)),
        )
        .subscribe({
          next: ({ dashboard, scrap }) => {
            this.dashboard.set(dashboard);
            this.scrapData.set(scrap);
          },
          error: () => {},
        });
      return;
    }

    forkJoin({
      dashboard: this.api.getAdminDashboard(id),
      scrap: this.api.getScrapOverview(id),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ dashboard, scrap }) => {
          this.dashboard.set(dashboard);
          this.scrapData.set(scrap);
        },
        error: () => {},
      });
  }

  exportToExcel(): void {
    const rows = this.detailRows();
    if (!rows.length) return;

    const tr = (key: string) => this.translate.instant(key);
    const wb = XLSX.utils.book_new();

    const totals = this.projectTotals();
    if (totals.length > 0) {
      const summaryAoa: (string | number)[][] = [
        [
          tr('ADMIN_PAGE.PROJECTS'),
          tr('ADMIN_SCRAP_PAGE.COL_TOTAL_SCRAP_CM'),
          tr('ADMIN_SCRAP_PAGE.COL_TOTAL_PIECES'),
          tr('ADMIN_SCRAP_PAGE.COL_ENTRIES'),
          tr('ADMIN_SCRAP_PAGE.COL_SHARE'),
        ],
        ...totals.map((t) => [
          t.projectName,
          Math.round(t.totalScrapCm * 100) / 100,
          t.totalPieces,
          t.rowCount,
          t.sharePct,
        ]),
      ];
      const wsSum = XLSX.utils.aoa_to_sheet(summaryAoa);
      XLSX.utils.book_append_sheet(
        wb,
        wsSum,
        this.clipSheetName(tr('ADMIN_SCRAP_PAGE.SHEET_SUMMARY')),
      );
    }

    const detailAoa: (string | number)[][] = [
      [
        tr('ADMIN_PAGE.PROJECTS'),
        tr('ADMIN_PROJECTS.COL_STATION'),
        tr('WORKER.SCRAP_LENGTH'),
        tr('ADMIN_PROJECTS.COL_SCRAP_QTY'),
        tr('ADMIN_SCRAP_PAGE.COL_LINE_CM'),
        tr('ADMIN_PROJECTS.COL_TIME'),
      ],
      ...rows.map((r) => [
        r.projectName,
        r.stationName,
        r.itemLengthCm,
        r.scrapQty,
        rowScrapCm(r),
        r.createdAt,
      ]),
    ];
    const wsDetail = XLSX.utils.aoa_to_sheet(detailAoa);
    XLSX.utils.book_append_sheet(
      wb,
      wsDetail,
      this.clipSheetName(tr('ADMIN_SCRAP_PAGE.SHEET_DETAIL')),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    const pid = this.projectFilter();
    let mid = 'all-projects';
    if (pid) {
      const label =
        this.dashboard()?.projects.find((p) => p.id === pid)?.name ?? pid;
      mid = this.safeFileSegment(label);
    }
    XLSX.writeFile(wb, `skyflow-scrap-${mid}-${stamp}.xlsx`);
  }

  private rebuildCharts(): void {
    const rows = this.detailRows();
    const loc = this.dateLocale();
    const m = this.metrics();

    const daily = aggregateScrapByDay(rows, loc, 21);
    this.dailyChartData.set({
      labels: daily.map((d) => d.label),
      datasets: [
        enhanceAdminLineDataset({
          label: this.translate.instant('ADMIN_SCRAP_PAGE.CHART_DAILY_CM'),
          data: daily.map((d) => Math.round(d.totalScrapCm)),
          borderColor: 'rgba(37, 99, 235, 1)',
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
        } as ChartDataset<'line', number[]>),
      ],
    });

    this.compareChartData.set({
      labels: [
        this.formatDayLabel(m.yesterdayKey),
        this.formatDayLabel(m.todayKey),
      ],
      datasets: [
        enhanceAdminBarDataset({
          label: this.translate.instant('ADMIN_SCRAP_PAGE.KPI_SCRAP_CM'),
          data: [
            Math.round(m.yesterdayCm),
            Math.round(m.todayCm),
          ],
          backgroundColor: [
            'rgba(100, 116, 139, 0.82)',
            'rgba(37, 99, 235, 0.88)',
          ],
        } as ChartDataset<'bar', number[]>),
      ],
    });

    const filtered = this.projectFilter();
    const topStations = filtered ? aggregateScrapByStation(rows) : [];
    const topProjects = filtered ? [] : this.projectTotals();
    const top = (filtered ? topStations : topProjects).slice(0, 8);
    const splitLabels = filtered
      ? topStations.slice(0, 8).map((s) => s.stationName)
      : topProjects.slice(0, 8).map((p) => p.projectName);
    const barColors = [
      'rgba(37, 99, 235, 0.88)',
      'rgba(56, 189, 248, 0.85)',
      'rgba(85, 143, 195, 0.85)',
      'rgba(99, 102, 241, 0.82)',
      'rgba(14, 165, 233, 0.8)',
      'rgba(59, 130, 246, 0.78)',
      'rgba(125, 211, 252, 0.75)',
      'rgba(148, 163, 184, 0.72)',
    ];
    this.splitChartData.set({
      labels: splitLabels,
      datasets: [
        enhanceAdminBarDataset({
          label: this.translate.instant('ADMIN_SCRAP_PAGE.KPI_SCRAP_CM'),
          data: top.map((x) => Math.round(x.totalScrapCm)),
          backgroundColor: barColors.slice(0, top.length),
        } as ChartDataset<'bar', number[]>),
      ],
    });
  }

  private lineBarOptions(themeLight: boolean): ChartConfiguration['options'] {
    const axisColor = themeLight ? '#475569' : '#cbd5e1';
    const grid = themeLight
      ? 'rgba(15, 23, 42, 0.07)'
      : 'rgba(255,255,255,0.06)';
    const legendColor = themeLight ? '#0f172a' : '#f8fafc';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: legendColor,
            font: { size: 13, weight: 600 },
            usePointStyle: true,
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          padding: 10,
          cornerRadius: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: axisColor, font: { size: 12 }, maxRotation: 45 },
          grid: { color: grid },
        },
        y: {
          beginAtZero: true,
          ticks: { color: axisColor, font: { size: 12 } },
          grid: { color: grid },
        },
      },
    };
  }

  private clipSheetName(name: string): string {
    const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
    return cleaned.slice(0, 31) || 'Sheet1';
  }

  private safeFileSegment(name: string): string {
    const t = name.replace(/[/:*?"<>|\\]/g, '_').trim();
    return (t || 'project').slice(0, 48);
  }
}
