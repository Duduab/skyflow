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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { fromEvent } from 'rxjs';
import { finalize, take } from 'rxjs';

import { ApiService } from '../../../core/api.service';
import {
  AdminDashboard,
  AdminProjectRow,
  ProjectActivityResponse,
  ProjectOpenedByUser,
} from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';
import { MatIconComponent } from '../../../shared/mat-icon/mat-icon.component';
import { StationsIconComponent } from '../../../shared/icons/stations-icon.component';
import { UiCardActionComponent } from '../../../shared/ui-card-action/ui-card-action.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { UiSelectComponent } from '../../../shared/ui-select/ui-select.component';
import { UiSelectOption } from '../../../shared/ui-select/ui-select.types';
import { StationLabelPipe } from '../../../shared/station-label.pipe';

type AdminProjectsStatusFilter =
  | 'all'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ON_HOLD';

@Component({
  selector: 'skyflow-admin-projects',
  imports: [
    RouterLink,
    TranslateModule,
    DatePipe,
    DecimalPipe,
    UiPopupComponent,
    UiSelectComponent,
    UiCardActionComponent,
    MatIconComponent,
    StationsIconComponent,
    StationLabelPipe,
  ],
  templateUrl: './admin-projects.component.html',
  styleUrl: './admin-projects.component.scss',
})
export class AdminProjectsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
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
  readonly openedByPhotoFailedIds = signal<Set<string>>(new Set());

  readonly scrapMmTotal = computed(() => {
    const rows = this.detailData()?.scrapRows;
    if (!rows?.length) return 0;
    return rows.reduce((a, r) => a + r.itemLengthMm * r.scrapQty, 0);
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

  openedByName(u: ProjectOpenedByUser): string {
    return `${u.firstName} ${u.lastName}`.trim();
  }

  openedByInitials(u: ProjectOpenedByUser): string {
    const a = u.firstName?.trim().charAt(0) ?? '';
    const b = u.lastName?.trim().charAt(0) ?? '';
    return (a + b).toUpperCase() || '?';
  }

  openedByPhotoVisible(u: ProjectOpenedByUser): boolean {
    const url = u.photoUrl?.trim();
    if (!url) return false;
    return !this.openedByPhotoFailedIds().has(u.id);
  }

  onOpenedByPhotoError(userId: string): void {
    this.openedByPhotoFailedIds.update((s) => new Set(s).add(userId));
  }

  setStatusFilter(value: string | number | null): void {
    const v = value == null ? 'all' : String(value);
    if (
      v === 'all' ||
      v === 'PENDING' ||
      v === 'IN_PROGRESS' ||
      v === 'COMPLETED' ||
      v === 'ON_HOLD'
    ) {
      this.statusFilter.set(v);
    }
  }

  statusFilterOptions(): UiSelectOption<AdminProjectsStatusFilter>[] {
    return [
      { value: 'all', label: this.translate.instant('ADMIN_PROJECTS.FILTER_ALL') },
      { value: 'PENDING', label: this.translate.instant('ORDER_STATUS.PENDING') },
      {
        value: 'IN_PROGRESS',
        label: this.translate.instant('ORDER_STATUS.IN_PROGRESS'),
      },
      { value: 'COMPLETED', label: this.translate.instant('ORDER_STATUS.COMPLETED') },
      { value: 'ON_HOLD', label: this.translate.instant('ORDER_STATUS.ON_HOLD') },
    ];
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
