import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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

export interface ScrapProjectTotalVm {
  projectId: string;
  projectName: string;
  totalScrapCm: number;
  totalPieces: number;
  rowCount: number;
}

function aggregateScrapByProject(
  rows: ScrapOverviewRow[],
): ScrapProjectTotalVm[] {
  const map = new Map<string, ScrapProjectTotalVm>();
  for (const r of rows) {
    const cm = r.itemLengthCm * r.scrapQty;
    const cur = map.get(r.projectId);
    if (!cur) {
      map.set(r.projectId, {
        projectId: r.projectId,
        projectName: r.projectName,
        totalScrapCm: cm,
        totalPieces: r.scrapQty,
        rowCount: 1,
      });
    } else {
      cur.totalScrapCm += cm;
      cur.totalPieces += r.scrapQty;
      cur.rowCount += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName, undefined, {
      sensitivity: 'base',
    }),
  );
}

@Component({
  selector: 'skyflow-admin-scrap',
  imports: [TranslateModule, DecimalPipe, DatePipe],
  templateUrl: './admin-scrap.component.html',
  styleUrl: './admin-scrap.component.scss',
})
export class AdminScrapComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lang = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(true);
  readonly dashboard = signal<AdminDashboard | null>(null);
  readonly scrapData = signal<ScrapOverviewResponse | null>(null);
  /** null = כל הפרויקטים */
  readonly projectFilter = signal<string | null>(null);

  readonly projectTotals = computed((): ScrapProjectTotalVm[] => {
    if (this.projectFilter()) return [];
    const rows = this.scrapData()?.rows;
    if (!rows?.length) return [];
    return aggregateScrapByProject(rows);
  });

  readonly detailRows = computed(
    () => this.scrapData()?.rows ?? [],
  );

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

    this.api
      .getScrapOverview(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (scrap) => this.scrapData.set(scrap),
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
        ],
        ...totals.map((t) => [
          t.projectName,
          Math.round(t.totalScrapCm * 100) / 100,
          t.totalPieces,
          t.rowCount,
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
        tr('ADMIN_PROJECTS.COL_TIME'),
      ],
      ...rows.map((r) => [
        r.projectName,
        r.stationName,
        r.itemLengthCm,
        r.scrapQty,
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

  private clipSheetName(name: string): string {
    const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
    return cleaned.slice(0, 31) || 'Sheet1';
  }

  private safeFileSegment(name: string): string {
    const t = name.replace(/[/:*?"<>|\\]/g, '_').trim();
    return (t || 'project').slice(0, 48);
  }
}
