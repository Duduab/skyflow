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
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import * as XLSX from 'xlsx';
import { finalize } from 'rxjs/operators';

import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { ApiService } from '../../../core/api.service';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';
import {
  SkyflowRole,
  UserDto,
  UserPerformanceResponse,
  UserPerformanceStationRow,
} from '../../../core/skyflow.models';

const ROLE_OPTIONS: SkyflowRole[] = [
  'WORKER',
  'ADMIN',
  'PLANNING',
  'STATION_MANAGER',
  'SITE_MANAGER',
];

type RoleFilter = SkyflowRole | '';

@Component({
  selector: 'skyflow-admin-users',
  imports: [
    FormsModule,
    TranslateModule,
    UiButtonComponent,
    UiPopupComponent,
    DecimalPipe,
    DatePipe,
  ],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lang = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  readonly theme = inject(ThemeService);

  readonly loading = signal(true);
  readonly users = signal<UserDto[]>([]);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);

  readonly roleFilter = signal<RoleFilter>('');

  readonly detailUser = signal<UserDto | null>(null);
  readonly performance = signal<UserPerformanceResponse | null>(null);
  readonly performanceLoading = signal(false);
  readonly performanceError = signal(false);

  readonly roleOptions = ROLE_OPTIONS;
  readonly roleFilterOptions: { value: RoleFilter; labelKey: string }[] = [
    { value: '', labelKey: 'ADMIN_USERS_PAGE.FILTER_ALL' },
    ...ROLE_OPTIONS.map((r) => ({
      value: r as RoleFilter,
      labelKey: `ADMIN_USERS_PAGE.ROLE_${r}`,
    })),
  ];

  readonly filteredUsers = computed(() => {
    const role = this.roleFilter();
    const list = this.users();
    if (!role) return list;
    return list.filter((u) => u.role === role);
  });

  readonly filterEmpty = computed(
    () => this.users().length > 0 && this.filteredUsers().length === 0,
  );

  readonly maxStationProcessed = computed(() => {
    const rows = this.performance()?.byStation ?? [];
    return Math.max(1, ...rows.map((r) => r.processedQty));
  });

  readonly maxDayReports = computed(() => {
    const rows = this.performance()?.dailyActivity ?? [];
    return Math.max(1, ...rows.map((r) => r.reports));
  });

  newEmail = '';
  newPassword = '';
  newFirstName = '';
  newLastName = '';
  newRole: SkyflowRole = 'WORKER';
  newManagedStationId: number | null = null;

  editingUserId: string | null = null;
  editEmail = '';
  editPassword = '';
  editFirstName = '';
  editLastName = '';
  editRole: SkyflowRole = 'WORKER';
  editManagedStationId: number | null = null;

  ngOnInit(): void {
    this.reloadUsers();
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  initials(u: UserDto): string {
    const a = u.firstName?.trim().charAt(0) ?? '';
    const b = u.lastName?.trim().charAt(0) ?? '';
    return (a + b).toUpperCase() || '?';
  }

  roleBadgeClass(role: SkyflowRole): string {
    if (role === 'ADMIN') return 'admin-users__role--admin';
    if (role === 'PLANNING') return 'admin-users__role--planning';
    if (role === 'STATION_MANAGER') return 'admin-users__role--station';
    if (role === 'SITE_MANAGER') return 'admin-users__role--site';
    return 'admin-users__role--worker';
  }

  isRoleFilterActive(value: RoleFilter): boolean {
    return this.roleFilter() === value;
  }

  setRoleFilter(value: RoleFilter): void {
    this.roleFilter.set(value);
  }

  stationBarPct(row: UserPerformanceStationRow): number {
    return Math.round((row.processedQty / this.maxStationProcessed()) * 100);
  }

  dayBarPct(reports: number): number {
    return Math.round((reports / this.maxDayReports()) * 100);
  }

  formatDayLabel(dateKey: string): string {
    const dt = new Date(`${dateKey}T12:00:00`);
    return dt.toLocaleDateString(this.dateLocale(), {
      day: 'numeric',
      month: 'short',
    });
  }

  openCreateModal(): void {
    this.formError.set(null);
    this.createModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.createModalOpen.set(false);
  }

  openEditModal(u: UserDto, event?: Event): void {
    event?.stopPropagation();
    this.formError.set(null);
    this.editingUserId = u.id;
    this.editEmail = u.email;
    this.editPassword = '';
    this.editFirstName = u.firstName;
    this.editLastName = u.lastName;
    this.editRole = u.role;
    this.editManagedStationId = u.managedStationId;
    this.editModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editModalOpen.set(false);
    this.editingUserId = null;
  }

  openUserDetail(u: UserDto): void {
    this.detailUser.set(u);
    this.performance.set(null);
    this.performanceError.set(false);
    this.performanceLoading.set(true);
    this.api
      .getUserPerformance(u.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.performanceLoading.set(false)),
      )
      .subscribe({
        next: (p) => this.performance.set(p),
        error: () => this.performanceError.set(true),
      });
  }

  closeUserDetail(): void {
    this.detailUser.set(null);
    this.performance.set(null);
    this.performanceError.set(false);
  }

  openEditFromDetail(): void {
    const u = this.detailUser();
    if (!u) return;
    this.openEditModal(u);
  }

  needsStationForRole(role: SkyflowRole): boolean {
    return role === 'STATION_MANAGER' || role === 'SITE_MANAGER';
  }

  needsStation(): boolean {
    return this.needsStationForRole(this.newRole);
  }

  needsStationEdit(): boolean {
    return this.needsStationForRole(this.editRole);
  }

  submitCreate(): void {
    this.formError.set(null);
    const email = this.newEmail.trim();
    const password = this.newPassword;
    const firstName = this.newFirstName.trim();
    const lastName = this.newLastName.trim();
    if (!email || !password || !firstName || !lastName) {
      this.formError.set('ADMIN_USERS_PAGE.FORM_REQUIRED');
      return;
    }
    if (password.length < 6) {
      this.formError.set('ADMIN_USERS_PAGE.PASSWORD_MIN');
      return;
    }
    const body: Parameters<ApiService['createUser']>[0] = {
      email,
      password,
      firstName,
      lastName,
      role: this.newRole,
    };
    if (this.needsStation() && this.newManagedStationId != null) {
      body.managedStationId = this.newManagedStationId;
    }
    this.saving.set(true);
    this.api
      .createUser(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          this.saving.set(false);
          this.upsertUser(u);
          this.resetCreateForm();
          this.closeCreateModal();
        },
        error: () => {
          this.saving.set(false);
          this.formError.set('ADMIN_USERS_PAGE.FORM_ERROR');
        },
      });
  }

  submitEdit(): void {
    const id = this.editingUserId;
    if (!id) return;
    this.formError.set(null);
    const email = this.editEmail.trim();
    const firstName = this.editFirstName.trim();
    const lastName = this.editLastName.trim();
    if (!email || !firstName || !lastName) {
      this.formError.set('ADMIN_USERS_PAGE.FORM_REQUIRED');
      return;
    }
    if (this.editPassword && this.editPassword.length < 6) {
      this.formError.set('ADMIN_USERS_PAGE.PASSWORD_MIN');
      return;
    }
    const body: Parameters<ApiService['updateUser']>[1] = {
      email,
      firstName,
      lastName,
      role: this.editRole,
    };
    if (this.editPassword.trim()) {
      body.password = this.editPassword;
    }
    if (this.needsStationEdit()) {
      body.managedStationId = this.editManagedStationId;
    } else {
      body.managedStationId = null;
    }
    this.saving.set(true);
    this.api
      .updateUser(id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          this.saving.set(false);
          this.upsertUser(u);
          if (this.detailUser()?.id === u.id) {
            this.detailUser.set(u);
          }
          this.closeEditModal();
        },
        error: () => {
          this.saving.set(false);
          this.formError.set('ADMIN_USERS_PAGE.EDIT_ERROR');
        },
      });
  }

  exportRosterExcel(): void {
    const rows = this.filteredUsers();
    if (!rows.length) return;
    const tr = (key: string) => this.translate.instant(key);
    const aoa: (string | number)[][] = [
      [
        tr('ADMIN_USERS_PAGE.NAME'),
        tr('ADMIN_USERS_PAGE.EMAIL'),
        tr('ADMIN_USERS_PAGE.ROLE'),
        tr('ADMIN_USERS_PAGE.STATION_COL'),
      ],
      ...rows.map((u) => [
        `${u.firstName} ${u.lastName}`.trim(),
        u.email,
        tr(`ADMIN_USERS_PAGE.ROLE_${u.role}`),
        u.managedStationId ?? '—',
      ]),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      this.clipSheetName(tr('ADMIN_USERS_PAGE.SHEET_ROSTER')),
    );
    const rolePart = this.roleFilter()
      ? this.safeFileSegment(this.roleFilter())
      : 'all';
    XLSX.writeFile(
      wb,
      `skyflow-users-${rolePart}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  exportPerformanceExcel(): void {
    const u = this.detailUser();
    const p = this.performance();
    if (!u || !p) return;
    const tr = (key: string) => this.translate.instant(key);
    const wb = XLSX.utils.book_new();
    const s = p.summary;

    const summaryAoa: (string | number)[][] = [
      [tr('ADMIN_USERS_PAGE.EXPORT_METRIC'), tr('ADMIN_USERS_PAGE.EXPORT_VALUE')],
      [tr('ADMIN_USERS_PAGE.NAME'), `${u.firstName} ${u.lastName}`.trim()],
      [tr('ADMIN_USERS_PAGE.EMAIL'), u.email],
      [tr('ADMIN_USERS_PAGE.ROLE'), tr(`ADMIN_USERS_PAGE.ROLE_${u.role}`)],
      [tr('ADMIN_USERS_PAGE.KPI_HOURS'), s.estimatedActiveHours],
      [tr('ADMIN_USERS_PAGE.KPI_REPORTS'), s.totalReports],
      [tr('ADMIN_USERS_PAGE.KPI_UNITS'), s.totalProcessedQty],
      [tr('ADMIN_USERS_PAGE.KPI_PROJECTS'), s.projectsTouched],
      [tr('ADMIN_USERS_PAGE.KPI_ACTIVE_DAYS'), s.activeDays],
      [tr('ADMIN_USERS_PAGE.KPI_TODAY'), s.todayReports],
      [tr('ADMIN_USERS_PAGE.KPI_YESTERDAY'), s.yesterdayReports],
      [
        tr('ADMIN_USERS_PAGE.KPI_PACE'),
        s.paceVsPlantPct != null ? `${s.paceVsPlantPct}%` : '—',
      ],
      [
        tr('ADMIN_USERS_PAGE.LAST_ACTIVITY'),
        s.lastActivityAt ?? '—',
      ],
    ];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(summaryAoa),
      this.clipSheetName(tr('ADMIN_USERS_PAGE.SHEET_SUMMARY')),
    );

    if (p.byStation.length) {
      const stationAoa: (string | number)[][] = [
        [
          tr('ADMIN_USERS_PAGE.STATION_COL'),
          tr('ADMIN_USERS_PAGE.KPI_REPORTS'),
          tr('ADMIN_USERS_PAGE.KPI_UNITS'),
        ],
        ...p.byStation.map((row) => [
          row.stationId,
          row.reports,
          row.processedQty,
        ]),
      ];
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(stationAoa),
        this.clipSheetName(tr('ADMIN_USERS_PAGE.BY_STATION')),
      );
    }

    if (p.dailyActivity.length) {
      const dailyAoa: (string | number)[][] = [
        [
          tr('ADMIN_USERS_PAGE.COL_DATE'),
          tr('ADMIN_USERS_PAGE.KPI_REPORTS'),
          tr('ADMIN_USERS_PAGE.KPI_UNITS'),
          tr('ADMIN_USERS_PAGE.KPI_HOURS'),
        ],
        ...p.dailyActivity.map((d) => [
          d.date,
          d.reports,
          d.processedQty,
          d.estimatedHours,
        ]),
      ];
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(dailyAoa),
        this.clipSheetName(tr('ADMIN_USERS_PAGE.DAILY_TREND')),
      );
    }

    if (p.recentActivity.length) {
      const actAoa: (string | number)[][] = [
        [
          tr('ADMIN_USERS_PAGE.COL_TIME'),
          tr('ADMIN_USERS_PAGE.COL_PROJECT'),
          tr('ADMIN_USERS_PAGE.STATION_COL'),
          tr('ADMIN_USERS_PAGE.COL_QTY'),
        ],
        ...p.recentActivity.map((a) => [
          a.createdAt,
          a.projectName,
          a.stationId,
          a.processedQty,
        ]),
      ];
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(actAoa),
        this.clipSheetName(tr('ADMIN_USERS_PAGE.RECENT_ACTIVITY')),
      );
    }

    const slug = this.safeFileSegment(`${u.lastName}-${u.firstName}`);
    XLSX.writeFile(
      wb,
      `skyflow-user-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  private resetCreateForm(): void {
    this.newEmail = '';
    this.newPassword = '';
    this.newFirstName = '';
    this.newLastName = '';
    this.newRole = 'WORKER';
    this.newManagedStationId = null;
  }

  private upsertUser(u: UserDto): void {
    this.users.update((list) => {
      const next = list.filter((x) => x.id !== u.id);
      next.push(u);
      return next.sort((a, b) => {
        const byRole = a.role.localeCompare(b.role);
        if (byRole !== 0) return byRole;
        return a.lastName.localeCompare(b.lastName);
      });
    });
  }

  private reloadUsers(): void {
    this.loading.set(true);
    this.api
      .getUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          this.users.set(u);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  private clipSheetName(name: string): string {
    const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
    return cleaned.slice(0, 31) || 'Sheet1';
  }

  private safeFileSegment(name: string): string {
    const t = name.replace(/[/:*?"<>|\\]/g, '_').trim();
    return (t || 'user').slice(0, 48);
  }
}
