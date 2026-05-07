import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { fromEvent } from 'rxjs';
import { finalize, take } from 'rxjs';

import { ApiService } from '../../../core/api.service';
import {
  AdminDashboard,
  AdminProjectRow,
  ProjectActivityResponse,
} from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';

type AdminProjectsStatusFilter = 'all' | 'IN_PROGRESS' | 'COMPLETED';

@Component({
  selector: 'skyflow-admin-projects',
  imports: [RouterLink, TranslateModule, DatePipe, DecimalPipe],
  templateUrl: './admin-projects.component.html',
  styleUrl: './admin-projects.component.scss',
})
export class AdminProjectsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lang = inject(LanguageService);
  readonly theme = inject(ThemeService);

  readonly loading = signal(true);
  readonly data = signal<AdminDashboard | null>(null);
  readonly error = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly statusFilter = signal<AdminProjectsStatusFilter>('all');

  readonly filteredProjects = computed((): AdminProjectRow[] => {
    const d = this.data();
    if (!d?.projects?.length) return [];
    const sf = this.statusFilter();
    const list =
      sf === 'all'
        ? d.projects
        : d.projects.filter((p) => p.status === sf);
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  });

  readonly detailOpen = signal(false);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly detailData = signal<ProjectActivityResponse | null>(null);
  readonly selectedCard = signal<AdminProjectRow | null>(null);

  readonly scrapCmTotal = computed(() => {
    const rows = this.detailData()?.scrapRows;
    if (!rows?.length) return 0;
    return rows.reduce((a, r) => a + r.itemLengthCm * r.scrapQty, 0);
  });

  ngOnInit(): void {
    this.api
      .getAdminDashboard(null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('טעינה נכשלה');
          this.loading.set(false);
        },
      });

    fromEvent<KeyboardEvent>(document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ev) => {
        if (ev.key === 'Escape' && this.detailOpen()) {
          ev.preventDefault();
          this.closeDetail();
        }
      });
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  setSearch(value: string): void {
    this.searchQuery.set(value);
  }

  setStatusFilter(value: string): void {
    if (value === 'all' || value === 'IN_PROGRESS' || value === 'COMPLETED') {
      this.statusFilter.set(value);
    }
  }

  openDetail(p: AdminProjectRow): void {
    this.selectedCard.set(p);
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.detailData.set(null);
    this.lockScroll(true);

    this.api
      .getProjectActivity(p.id)
      .pipe(
        take(1),
        finalize(() => this.detailLoading.set(false)),
      )
      .subscribe({
        next: (res) => {
          if (!res?.project?.id) {
            this.detailData.set(null);
            this.detailError.set(
              'לא התקבלו נתונים מהשרת (תגובה ריקה או שגיאת מטמון). נסו לסגור ולפתוח שוב.',
            );
            return;
          }
          this.detailData.set(res);
          this.detailError.set(null);
        },
        error: () => {
          this.detailError.set('פרטי הפרויקט לא נטענו');
        },
      });
  }

  closeDetail(): void {
    if (!this.detailOpen()) return;
    this.detailOpen.set(false);
    this.detailData.set(null);
    this.detailError.set(null);
    this.selectedCard.set(null);
    this.lockScroll(false);
  }

  private lockScroll(lock: boolean): void {
    document.body.style.overflow = lock ? 'hidden' : '';
  }
}
