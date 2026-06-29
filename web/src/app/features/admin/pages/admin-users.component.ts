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

import { MatIconComponent } from '../../../shared/mat-icon/mat-icon.component';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { UiSelectComponent } from '../../../shared/ui-select/ui-select.component';
import { UiSelectOption } from '../../../shared/ui-select/ui-select.types';
import { ApiService } from '../../../core/api.service';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';
import {
  SkyflowRole,
  UserDto,
  UserDailyTargetDayRow,
  UserDailyTargetLineItemRow,
  UserDailyTargetsResponse,
  UserDailyTargetAlertRow,
  UserDailyTargetAlertLevel,
  UserPerformanceResponse,
  UserPerformanceStationRow,
} from '../../../core/skyflow.models';
import {
  PROGRESS_RING_C,
  progressDashOffset,
} from '../../worker/station-progress';

const ROLE_OPTIONS: SkyflowRole[] = [
  'WORKER',
  'ADMIN',
  'PLANNING',
  'STATION_MANAGER',
  'SITE_MANAGER',
];

type RoleFilter = SkyflowRole | '';
type UsersStationFilter = '' | 'any' | 'none' | '1' | '2' | '3' | '4' | '5' | '6' | '7';
type UsersTargetFilter = '' | 'alert' | 'warning' | 'missed' | 'ok';
type UsersTeamFilter = '' | 'field' | 'management' | 'planning';
type UsersAssignmentFilter = '' | 'assigned' | 'missing_station';

@Component({
  selector: 'skyflow-admin-users',
  imports: [
    FormsModule,
    TranslateModule,
    UiButtonComponent,
    MatIconComponent,
    UiPopupComponent,
    UiSelectComponent,
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
  readonly searchQuery = signal('');
  readonly stationFilter = signal<UsersStationFilter>('');
  readonly targetFilter = signal<UsersTargetFilter>('');
  readonly teamFilter = signal<UsersTeamFilter>('');
  readonly assignmentFilter = signal<UsersAssignmentFilter>('');

  readonly detailUser = signal<UserDto | null>(null);
  readonly performance = signal<UserPerformanceResponse | null>(null);
  readonly performanceLoading = signal(false);
  readonly performanceError = signal(false);

  readonly dailyTargetUser = signal<UserDto | null>(null);
  readonly dailyTargets = signal<UserDailyTargetsResponse | null>(null);
  readonly dailyTargetLoading = signal(false);
  readonly dailyTargetError = signal(false);
  readonly dailyTargetSaving = signal(false);
  readonly dailyTargetFormError = signal<string | null>(null);
  readonly dailyTargetAddOpen = signal(false);
  readonly dailyTargetSelectedDate = signal<string | null>(null);

  readonly targetAlerts = signal<UserDailyTargetAlertRow[]>([]);

  readonly progressCircumference = PROGRESS_RING_C;
  readonly progressDashOffset = progressDashOffset;

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
    const q = this.searchQuery().trim().toLowerCase();
    const station = this.stationFilter();
    const target = this.targetFilter();
    const team = this.teamFilter();
    const assignment = this.assignmentFilter();
    const alerts = this.targetAlertByUserId();
    let list = this.users();

    if (role) {
      list = list.filter((u) => u.role === role);
    }

    if (q) {
      list = list.filter((u) => this.userMatchesSearch(u, q));
    }

    if (station === 'any') {
      list = list.filter((u) => u.managedStationId != null);
    } else if (station === 'none') {
      list = list.filter((u) => u.managedStationId == null);
    } else if (station) {
      list = list.filter((u) => u.managedStationId === Number(station));
    }

    if (target === 'alert') {
      list = list.filter((u) => alerts.has(u.id));
    } else if (target === 'warning') {
      list = list.filter((u) => alerts.get(u.id)?.level === 'warning');
    } else if (target === 'missed') {
      list = list.filter((u) => alerts.get(u.id)?.level === 'missed');
    } else if (target === 'ok') {
      list = list.filter((u) => !alerts.has(u.id));
    }

    if (team === 'field') {
      list = list.filter((u) => u.role === 'WORKER');
    } else if (team === 'management') {
      list = list.filter((u) =>
        u.role === 'ADMIN' || u.role === 'STATION_MANAGER' || u.role === 'SITE_MANAGER',
      );
    } else if (team === 'planning') {
      list = list.filter((u) => u.role === 'PLANNING');
    }

    if (assignment === 'assigned') {
      list = list.filter((u) => u.managedStationId != null);
    } else if (assignment === 'missing_station') {
      list = list.filter(
        (u) => this.needsStationForRole(u.role) && u.managedStationId == null,
      );
    }

    return list;
  });

  readonly hasActiveFilters = computed(
    () =>
      !!this.searchQuery().trim() ||
      !!this.roleFilter() ||
      !!this.stationFilter() ||
      !!this.targetFilter() ||
      !!this.teamFilter() ||
      !!this.assignmentFilter(),
  );

  readonly activeFilterCount = computed(() => {
    let n = 0;
    if (this.searchQuery().trim()) n++;
    if (this.roleFilter()) n++;
    if (this.stationFilter()) n++;
    if (this.targetFilter()) n++;
    if (this.teamFilter()) n++;
    if (this.assignmentFilter()) n++;
    return n;
  });

  readonly stationFilterOptions = computed((): UiSelectOption<UsersStationFilter>[] => [
    { value: '', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_ALL') },
    { value: 'any', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_STATION_ANY') },
    { value: 'none', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_STATION_NONE') },
    ...([1, 2, 3, 4, 5, 6, 7] as const).map((n) => ({
      value: String(n) as UsersStationFilter,
      label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_STATION_N', { n }),
    })),
  ]);

  readonly targetFilterOptions = computed((): UiSelectOption<UsersTargetFilter>[] => [
    { value: '', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_ALL') },
    { value: 'alert', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TARGET_ALERT') },
    { value: 'warning', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TARGET_WARNING') },
    { value: 'missed', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TARGET_MISSED') },
    { value: 'ok', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TARGET_OK') },
  ]);

  readonly teamFilterOptions = computed((): UiSelectOption<UsersTeamFilter>[] => [
    { value: '', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_ALL') },
    { value: 'field', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TEAM_FIELD') },
    { value: 'management', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TEAM_MANAGEMENT') },
    { value: 'planning', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_TEAM_PLANNING') },
  ]);

  readonly assignmentFilterOptions = computed((): UiSelectOption<UsersAssignmentFilter>[] => [
    { value: '', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_ALL') },
    { value: 'assigned', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_ASSIGNMENT_ASSIGNED') },
    { value: 'missing_station', label: this.translate.instant('ADMIN_USERS_PAGE.FILTER_ASSIGNMENT_MISSING') },
  ]);

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

  readonly dailyTargetFocusRow = computed(() => {
    const data = this.dailyTargets();
    if (!data) return null;
    const selected = this.dailyTargetSelectedDate();
    if (selected) {
      return (
        data.history.find((r) => r.date === selected) ??
        (data.today?.date === selected ? data.today : null)
      );
    }
    return data.today;
  });

  readonly dailyTargetRingPct = computed(() => {
    const row = this.dailyTargetFocusRow();
    if (!row?.hasTarget || row.achievementPct == null) return 0;
    return Math.min(100, row.achievementPct);
  });

  readonly dailyTargetRingLabel = computed(() => {
    const row = this.dailyTargetFocusRow();
    if (!row?.hasTarget) return '—';
    if (row.achievementPct == null) return '0';
    return String(Math.round(row.achievementPct));
  });

  readonly targetAlertByUserId = computed(() => {
    const map = new Map<string, UserDailyTargetAlertRow>();
    for (const alert of this.targetAlerts()) {
      map.set(alert.userId, alert);
    }
    return map;
  });

  readonly dailyTargetFocusAlert = computed(() => {
    const row = this.dailyTargetFocusRow();
    const todayKey = this.dailyTargets()?.todayKey ?? this.todayDateKey();
    if (!row) return null;
    return this.resolveTargetAlertLevel(row, todayKey);
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

  targetDate = '';
  targetDescription = '';
  targetHours = 8;

  ngOnInit(): void {
    this.reloadUsers();
    this.reloadTargetAlerts();
  }

  userTargetAlert(u: UserDto): UserDailyTargetAlertRow | undefined {
    return this.targetAlertByUserId().get(u.id);
  }

  resolveTargetAlertLevel(
    row: UserDailyTargetDayRow,
    todayKey: string,
  ): UserDailyTargetAlertLevel | null {
    if (!row.hasTarget || row.achievementPct == null || row.achievementPct >= 100) {
      return null;
    }
    if (row.date < todayKey) return 'missed';
    if (row.date > todayKey) return null;
    const hour = new Date().getHours();
    if (row.achievementPct < 80) return 'warning';
    if (hour >= 16) return 'missed';
    return null;
  }

  targetAlertLabelKey(level: UserDailyTargetAlertLevel): string {
    return level === 'missed'
      ? 'ADMIN_USERS_PAGE.TARGET_ALERT_MISSED'
      : 'ADMIN_USERS_PAGE.TARGET_ALERT_WARNING';
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

  setSearch(value: string): void {
    this.searchQuery.set(value);
  }

  setStationFilter(value: string | number | null): void {
    this.stationFilter.set((value ?? '') as UsersStationFilter);
  }

  setTargetFilter(value: string | number | null): void {
    this.targetFilter.set((value ?? '') as UsersTargetFilter);
  }

  setTeamFilter(value: string | number | null): void {
    this.teamFilter.set((value ?? '') as UsersTeamFilter);
  }

  setAssignmentFilter(value: string | number | null): void {
    this.assignmentFilter.set((value ?? '') as UsersAssignmentFilter);
  }

  clearAllFilters(): void {
    this.searchQuery.set('');
    this.roleFilter.set('');
    this.stationFilter.set('');
    this.targetFilter.set('');
    this.teamFilter.set('');
    this.assignmentFilter.set('');
  }

  private userMatchesSearch(u: UserDto, q: string): boolean {
    const roleLabel = this.translate.instant(`ADMIN_USERS_PAGE.ROLE_${u.role}`).toLowerCase();
    const haystack = [
      u.firstName,
      u.lastName,
      `${u.firstName} ${u.lastName}`,
      `${u.lastName} ${u.firstName}`,
      u.email,
      u.email.split('@')[0],
      this.initials(u),
      roleLabel,
      u.managedStationId != null ? String(u.managedStationId) : '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
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

  formatDayFull(dateKey: string): string {
    const dt = new Date(`${dateKey}T12:00:00`);
    return dt.toLocaleDateString(this.dateLocale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  formatMinutes(m: number): string {
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h <= 0) return `${min}${this.translate.instant('ADMIN_USERS_PAGE.TARGET_MINUTES_SHORT')}`;
    if (min === 0) return `${h}${this.translate.instant('ADMIN_USERS_PAGE.TARGET_HOURS_SHORT')}`;
    return `${h}${this.translate.instant('ADMIN_USERS_PAGE.TARGET_HOURS_SHORT')} ${min}${this.translate.instant('ADMIN_USERS_PAGE.TARGET_MINUTES_SHORT')}`;
  }

  formatTargetLineItem(line: UserDailyTargetLineItemRow): string {
    const parts: string[] = [];
    if (line.profileCode) parts.push(line.profileCode);
    if (line.cutLengthMm != null) {
      parts.push(
        `${line.cutLengthMm}${this.translate.instant('ADMIN_USERS_PAGE.TARGET_MM')}`,
      );
    }
    parts.push(
      `${line.targetQty} ${this.translate.instant('ADMIN_USERS_PAGE.TARGET_QTY_UNIT')}`,
    );
    const head = parts.join(' · ');
    const desc = line.description.trim();
    if (!desc) return head;
    const short =
      desc.length > 72 ? `${desc.slice(0, 69).trim()}…` : desc;
    return `${head} — ${short}`;
  }

  dayLineItems(row: UserDailyTargetDayRow): UserDailyTargetLineItemRow[] {
    return row.items.flatMap((item) => item.lineItems ?? []);
  }

  isTodayDate(dateKey: string): boolean {
    return dateKey === this.dailyTargets()?.todayKey;
  }

  isSelectedDailyTargetDay(dateKey: string): boolean {
    const selected = this.dailyTargetSelectedDate();
    if (selected) return selected === dateKey;
    return this.dailyTargets()?.today?.date === dateKey;
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

  openDailyTarget(u: UserDto, event?: Event): void {
    event?.stopPropagation();
    this.openDailyTargetForUser(u);
  }

  openDailyTargetById(userId: string): void {
    const u = this.users().find((x) => x.id === userId);
    if (u) this.openDailyTargetForUser(u);
  }

  closeDailyTarget(): void {
    this.dailyTargetUser.set(null);
    this.dailyTargets.set(null);
    this.dailyTargetError.set(false);
    this.dailyTargetFormError.set(null);
    this.dailyTargetAddOpen.set(false);
    this.dailyTargetSelectedDate.set(null);
  }

  selectDailyTargetDay(row: UserDailyTargetDayRow): void {
    this.dailyTargetSelectedDate.set(row.date);
  }

  toggleAddDailyTarget(): void {
    const next = !this.dailyTargetAddOpen();
    this.dailyTargetAddOpen.set(next);
    this.dailyTargetFormError.set(null);
    if (next) {
      const focus = this.dailyTargetFocusRow();
      this.targetDate = focus?.date ?? this.todayDateKey();
      if (focus?.hasTarget && focus.description) {
        this.targetDescription = focus.description;
        this.targetHours =
          focus.targetMinutes != null
            ? Math.round((focus.targetMinutes / 60) * 10) / 10
            : 8;
      }
    }
  }

  submitDailyTarget(): void {
    const u = this.dailyTargetUser();
    if (!u) return;
    this.dailyTargetFormError.set(null);
    const description = this.targetDescription.trim();
    const targetDate = this.targetDate.trim();
    const hours = Number(this.targetHours);
    if (!description || !targetDate) {
      this.dailyTargetFormError.set('ADMIN_USERS_PAGE.TARGET_FORM_REQUIRED');
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      this.dailyTargetFormError.set('ADMIN_USERS_PAGE.TARGET_HOURS_INVALID');
      return;
    }
    const targetMinutes = Math.round(hours * 60);
    this.dailyTargetSaving.set(true);
    this.api
      .upsertUserDailyTarget(u.id, {
        targetDate,
        description,
        targetMinutes,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.dailyTargetSaving.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.dailyTargets.set(res);
          this.dailyTargetSelectedDate.set(targetDate);
          this.dailyTargetAddOpen.set(false);
          this.resetTargetForm();
          this.reloadTargetAlerts();
        },
        error: () =>
          this.dailyTargetFormError.set('ADMIN_USERS_PAGE.TARGET_FORM_ERROR'),
      });
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

  roleSelectOptions(): UiSelectOption<SkyflowRole>[] {
    return this.roleOptions.map((role) => ({
      value: role,
      label: this.translate.instant(`ADMIN_USERS_PAGE.ROLE_${role}`),
    }));
  }

  stationSelectOptions(): UiSelectOption<number | null>[] {
    return [
      {
        value: null,
        label: this.translate.instant('ADMIN_USERS_PAGE.STATION_OPTIONAL'),
      },
      ...([1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))),
    ];
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

  exportDailyTargetExcel(): void {
    const u = this.dailyTargetUser();
    const data = this.dailyTargets();
    if (!u || !data) return;
    const tr = (key: string) => this.translate.instant(key);
    const wb = XLSX.utils.book_new();

    const summaryAoa: (string | number)[][] = [
      [tr('ADMIN_USERS_PAGE.EXPORT_METRIC'), tr('ADMIN_USERS_PAGE.EXPORT_VALUE')],
      [tr('ADMIN_USERS_PAGE.NAME'), `${u.firstName} ${u.lastName}`.trim()],
      [tr('ADMIN_USERS_PAGE.EMAIL'), u.email],
      [tr('ADMIN_USERS_PAGE.ROLE'), tr(`ADMIN_USERS_PAGE.ROLE_${u.role}`)],
    ];
    if (data.today) {
      summaryAoa.push(
        [tr('ADMIN_USERS_PAGE.TARGET_TODAY'), data.today.date],
        [
          tr('ADMIN_USERS_PAGE.TARGET_DESC'),
          data.today.description ?? '—',
        ],
        [
          tr('ADMIN_USERS_PAGE.TARGET_GOAL'),
          data.today.targetMinutes != null
            ? this.formatMinutes(data.today.targetMinutes)
            : '—',
        ],
        [
          tr('ADMIN_USERS_PAGE.TARGET_ACTUAL'),
          this.formatMinutes(data.today.actualMinutes),
        ],
        [
          tr('ADMIN_USERS_PAGE.TARGET_ACHIEVEMENT'),
          data.today.achievementPct != null ? `${data.today.achievementPct}%` : '—',
        ],
      );
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(summaryAoa),
      this.clipSheetName(tr('ADMIN_USERS_PAGE.SHEET_SUMMARY')),
    );

    if (data.history.length) {
      const historyAoa: (string | number)[][] = [
        [
          tr('ADMIN_USERS_PAGE.COL_DATE'),
          tr('ADMIN_USERS_PAGE.TARGET_DESC'),
          tr('ADMIN_USERS_PAGE.TARGET_GOAL'),
          tr('ADMIN_USERS_PAGE.TARGET_ACTUAL'),
          tr('ADMIN_USERS_PAGE.KPI_REPORTS'),
          tr('ADMIN_USERS_PAGE.KPI_UNITS'),
          tr('ADMIN_USERS_PAGE.TARGET_ACHIEVEMENT'),
        ],
        ...data.history.map((row) => [
          row.date,
          row.description ?? '—',
          row.targetMinutes != null ? this.formatMinutes(row.targetMinutes) : '—',
          this.formatMinutes(row.actualMinutes),
          row.reports,
          row.processedQty,
          row.achievementPct != null ? `${row.achievementPct}%` : '—',
        ]),
      ];
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(historyAoa),
        this.clipSheetName(tr('ADMIN_USERS_PAGE.TARGET_HISTORY')),
      );
    }

    const allItems = data.history.flatMap((row) =>
      row.items.flatMap((item) =>
        (item.lineItems?.length
          ? item.lineItems.map((line) => ({
              date: row.date,
              project: item.projectName ?? item.description,
              ...line,
            }))
          : [{ date: row.date, project: item.projectName ?? item.description, description: item.description, profileCode: null, cutLengthMm: null, instructionKind: '', targetQty: item.targetQty ?? 0, sortOrder: 0 }]),
      ),
    );
    if (allItems.length) {
      const itemsAoa: (string | number)[][] = [
        [
          tr('ADMIN_USERS_PAGE.COL_DATE'),
          tr('ADMIN_USERS_PAGE.COL_PROJECT'),
          tr('ADMIN_USERS_PAGE.TARGET_DESC'),
          tr('ADMIN_USERS_PAGE.TARGET_QTY_GOAL'),
        ],
        ...allItems.map((item) => [
          item.date,
          item.project,
          this.formatTargetLineItem(item as UserDailyTargetLineItemRow),
          item.targetQty,
        ]),
      ];
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(itemsAoa),
        this.clipSheetName(tr('ADMIN_USERS_PAGE.TARGET_ITEMS_SHEET')),
      );
    }

    const slug = this.safeFileSegment(`${u.lastName}-${u.firstName}`);
    XLSX.writeFile(
      wb,
      `skyflow-daily-target-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`,
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

  private reloadTargetAlerts(): void {
    this.api
      .getTodayTargetAlerts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.targetAlerts.set(res.alerts),
        error: () => this.targetAlerts.set([]),
      });
  }

  private openDailyTargetForUser(u: UserDto): void {
    this.dailyTargetUser.set(u);
    this.dailyTargets.set(null);
    this.dailyTargetError.set(false);
    this.dailyTargetFormError.set(null);
    this.dailyTargetAddOpen.set(false);
    this.dailyTargetSelectedDate.set(null);
    this.resetTargetForm();
    this.loadDailyTargets(u.id);
  }

  private loadDailyTargets(userId: string): void {
    this.dailyTargetLoading.set(true);
    this.api
      .getUserDailyTargets(userId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.dailyTargetLoading.set(false)),
      )
      .subscribe({
        next: (res) => this.dailyTargets.set(res),
        error: () => this.dailyTargetError.set(true),
      });
  }

  private resetTargetForm(): void {
    this.targetDate = this.todayDateKey();
    this.targetDescription = '';
    this.targetHours = 8;
  }

  private todayDateKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
