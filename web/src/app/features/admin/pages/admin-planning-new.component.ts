import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { concatMap, finalize, take } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  AssemblyWindowPartSection,
  EditWorkCycleWindowBody,
  PlanningAssigneeOptionDto,
  PlanningDraftListItemDto,
  ProjectAngleSourcing,
  ProjectFlowStatus,
  ProjectLineMaterial,
  ProjectMachiningRoute,
  WorkCycle,
  WorkCycleAssignmentInput,
  WorkCycleDetailsDto,
  WorkCycleStatus,
} from '../../../core/skyflow.models';
import {
  planningStation1ManagerSectionKey,
  stationLabelKey,
  stationMatIcon,
  stationMatIconFilled,
  workerFlowSequence,
} from '../../../core/station-presentation';
import { PlanningPdfPanelComponent } from '../planning/planning-pdf-panel.component';
import { MatIconComponent } from '../../../shared/mat-icon/mat-icon.component';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { UiSelectComponent } from '../../../shared/ui-select/ui-select.component';
import { UiSelectOption } from '../../../shared/ui-select/ui-select.types';

type WizardStep = 1 | 2 | 3;
type UnitStatusFilter = 'all' | WorkCycleStatus;

interface WizardCardOption<T extends string> {
  value: T;
  icon: string;
  titleKey: string;
  subtitleKey: string;
  emphKey: string;
  hintKey: string;
}

export interface PlanningSuccessSnapshot {
  name: string;
  notes: string;
  manager: string;
  workers: string;
}

@Component({
  selector: 'skyflow-admin-planning-new',
  standalone: true,
  imports: [
    DatePipe,
    TranslateModule,
    PlanningPdfPanelComponent,
    MatIconComponent,
    UiButtonComponent,
    UiPopupComponent,
    UiSelectComponent,
  ],
  templateUrl: './admin-planning-new.component.html',
  styleUrl: './admin-planning-new.component.scss',
})
export class AdminPlanningNewComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(true);
  readonly listError = signal<string | null>(null);
  readonly drafts = signal<PlanningDraftListItemDto[]>([]);

  readonly step = signal<WizardStep>(1);
  readonly newProjectName = signal('');
  readonly newProjectDetails = signal('');
  readonly lineMaterial = signal<ProjectLineMaterial>('ALUMINUM');
  readonly machiningRoute = signal<ProjectMachiningRoute>('GLASS');
  readonly angleSourcing = signal<ProjectAngleSourcing>('INTERNAL_LASER');
  readonly creating = signal(false);
  readonly createErrorKey = signal<string | null>(null);

  /** מנהלי אתר/פרויקט לבחירה בשלב פתיחת הפרויקט. */
  readonly siteManagers = signal<PlanningAssigneeOptionDto[]>([]);
  readonly siteManagersLoading = signal(false);
  readonly selectedProjectManagerId = signal<string | null>(null);

  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedFlow = signal<ProjectFlowStatus | null>(null);
  readonly selectedName = signal<string | null>(null);
  readonly successModalOpen = signal(false);
  readonly successSnapshot = signal<PlanningSuccessSnapshot | null>(null);

  readonly assignees = signal<PlanningAssigneeOptionDto[]>([]);
  readonly assigneesLoadError = signal<string | null>(null);
  readonly assigneesLoading = signal(false);
  readonly selectedSawsManagerId = signal<string | null>(null);
  readonly selectedWorkerIds = signal<string[]>([]);
  /** תמונת פרופיל שנכשלה בטעינה — מציגים ראשי תיבות במסגרת כמו במסוף עמדה */
  readonly assigneePhotoFailedIds = signal<Set<string>>(new Set());

  /** סבבי העבודה של הפרויקט (פר סוג-חלון) — לשיבוץ פר תחנה בשלב 3. */
  readonly workCycles = signal<WorkCycle[]>([]);
  readonly workCyclesLoading = signal(false);
  readonly workCyclesError = signal<string | null>(null);
  readonly selectedCycleId = signal<string | null>(null);
  readonly cycleSaving = signal(false);
  /** יעד יומי ידני לסבב הנבחר (null = חישוב אוטומטי). */
  readonly cycleDailyTarget = signal<number | null>(null);
  /** מסגרת זמן ליעד (שעות; null = חישוב אוטומטי). */
  readonly cycleDailyTargetHours = signal<number | null>(null);
  /** stationId → מנהל תחנה שנבחר לסבב הנבחר. */
  readonly cycleStationManager = signal<Record<number, string | null>>({});
  /** stationId → עובדים שנבחרו לסבב הנבחר. */
  readonly cycleStationWorkers = signal<Record<number, string[]>>({});
  /** פופאפ שיבוץ ליחידה שנבחרה מהגריד. */
  readonly cycleAssignModalOpen = signal(false);
  readonly cycleLaunching = signal(false);
  /** windowTypeId שהמתכנן ביקש "להוציא לפועל" מפופאפ החזיתות — לפתיחה אוטומטית בשלב 3. */
  private readonly pendingLaunchWindowTypeId = signal<string | null>(null);
  /** תחנה פעילה בתוך פופאפ השיבוץ. */
  readonly selectedAssignStationId = signal<number | null>(null);
  readonly unitStatusFilter = signal<UnitStatusFilter>('all');
  readonly unitSearchQuery = signal('');

  readonly unitsForAssignment = computed((): WorkCycle[] =>
    this.workCycles().filter((c) => this.hasInstructions(c)),
  );

  readonly filteredUnitsForAssignment = computed((): WorkCycle[] => {
    const list = this.unitsForAssignment();
    const status = this.unitStatusFilter();
    const q = this.unitSearchQuery().trim().toLowerCase();
    return list.filter((c) => {
      if (status !== 'all' && c.status !== status) return false;
      if (q && !c.windowType.code.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  readonly unitCodeSuggestions = computed((): string[] => {
    const q = this.unitSearchQuery().trim().toLowerCase();
    const codes = [
      ...new Set(this.unitsForAssignment().map((c) => c.windowType.code)),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!q) return codes;
    return codes.filter((code) => code.toLowerCase().includes(q));
  });

  ngOnInit(): void {
    this.reloadDrafts();
    this.loadSiteManagers();
  }

  private loadSiteManagers(): void {
    if (this.siteManagers().length || this.siteManagersLoading()) return;
    this.siteManagersLoading.set(true);
    this.api
      .getSiteManagers()
      .pipe(
        take(1),
        finalize(() => this.siteManagersLoading.set(false)),
      )
      .subscribe({
        next: (list) => this.siteManagers.set(list),
        error: () => this.siteManagers.set([]),
      });
  }

  /** אפשרויות בורר מנהל הפרויקט (select). */
  readonly projectManagerOptions = computed(() =>
    this.siteManagers().map((m) => ({
      value: m.id,
      label: `${m.firstName} ${m.lastName}`.trim(),
    })),
  );

  onProjectManagerSelect(ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value;
    this.selectedProjectManagerId.set(value || null);
  }

  reloadDrafts(): void {
    this.loading.set(true);
    this.listError.set(null);
    this.api
      .getPlanningDraftsList()
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (rows) => {
          this.drafts.set(rows);
          const draftId = this.route.snapshot.queryParamMap.get('draftId');
          if (draftId) {
            const pick = rows.find((r) => r.id === draftId);
            if (pick) {
              this.resumeDraft(pick);
            } else if (this.selectedProjectId() !== draftId) {
              // Not in the drafts list (e.g. already in production) — fetch it
              // directly so the planner can add more production instructions.
              this.api
                .getPlanningResumeItem(draftId)
                .pipe(take(1))
                .subscribe({
                  next: (item) => this.resumeDraft(item),
                  error: () => this.listError.set('PLANNING_NEW.LOAD_LIST_FAILED'),
                });
            }
          }
          const cur = this.selectedProjectId();
          if (cur && rows.some((r) => r.id === cur)) {
            const r = rows.find((x) => x.id === cur)!;
            this.applyPick(r);
            return;
          }
          if (cur && !rows.some((r) => r.id === cur)) {
            this.selectedProjectId.set(null);
            this.selectedFlow.set(null);
            this.selectedName.set(null);
            this.step.set(1);
            this.selectedSawsManagerId.set(null);
            this.selectedWorkerIds.set([]);
            this.resetCycleSelection();
            this.newProjectName.set('');
            this.newProjectDetails.set('');
            this.selectedProjectManagerId.set(null);
            return;
          }
        },
        error: () => this.listError.set('PLANNING_NEW.LOAD_LIST_FAILED'),
      });
  }

  private applyPick(r: PlanningDraftListItemDto): void {
    this.selectedFlow.set(r.flowStatus);
    this.selectedName.set(r.name);
  }

  onWizardNameInput(ev: Event): void {
    this.newProjectName.set((ev.target as HTMLInputElement).value);
    this.createErrorKey.set(null);
  }

  onWizardDetailsInput(ev: Event): void {
    this.newProjectDetails.set((ev.target as HTMLTextAreaElement).value);
  }

  selectLineMaterial(value: ProjectLineMaterial): void {
    this.lineMaterial.set(value);
  }

  selectMachiningRoute(value: ProjectMachiningRoute): void {
    this.machiningRoute.set(value);
  }

  selectAngleSourcing(value: ProjectAngleSourcing): void {
    this.angleSourcing.set(value);
  }

  readonly lineMaterialCardOptions = computed((): WizardCardOption<ProjectLineMaterial>[] => [
    {
      value: 'ALUMINUM',
      icon: 'window',
      titleKey: 'PLANNING_NEW.LINE_MATERIAL_ALUMINUM',
      subtitleKey: 'PLANNING_NEW.LINE_MATERIAL_ALUMINUM_CARD_SUB',
      emphKey: 'PLANNING_NEW.LINE_MATERIAL_ALUMINUM_CARD_EMPH',
      hintKey: 'PLANNING_NEW.LINE_MATERIAL_ALUMINUM_CARD_HINT',
    },
    {
      value: 'STEEL',
      icon: 'construction',
      titleKey: 'PLANNING_NEW.LINE_MATERIAL_STEEL',
      subtitleKey: 'PLANNING_NEW.LINE_MATERIAL_STEEL_CARD_SUB',
      emphKey: 'PLANNING_NEW.LINE_MATERIAL_STEEL_CARD_EMPH',
      hintKey: 'PLANNING_NEW.LINE_MATERIAL_STEEL_CARD_HINT',
    },
  ]);

  readonly machiningRouteCardOptions = computed((): WizardCardOption<ProjectMachiningRoute>[] => [
    {
      value: 'GLASS',
      icon: 'door_sliding',
      titleKey: 'PLANNING_NEW.MACHINING_ROUTE_GLASS',
      subtitleKey: 'PLANNING_NEW.MACHINING_ROUTE_GLASS_CARD_SUB',
      emphKey: 'PLANNING_NEW.MACHINING_ROUTE_GLASS_CARD_EMPH',
      hintKey: 'PLANNING_NEW.MACHINING_ROUTE_GLASS_CARD_HINT',
    },
    {
      value: 'ALU_RANGER',
      icon: 'precision_manufacturing',
      titleKey: 'PLANNING_NEW.MACHINING_ROUTE_ALU_RANGER',
      subtitleKey: 'PLANNING_NEW.MACHINING_ROUTE_ALU_RANGER_CARD_SUB',
      emphKey: 'PLANNING_NEW.MACHINING_ROUTE_ALU_RANGER_CARD_EMPH',
      hintKey: 'PLANNING_NEW.MACHINING_ROUTE_ALU_RANGER_CARD_HINT',
    },
  ]);

  readonly angleSourcingCardOptions = computed((): WizardCardOption<ProjectAngleSourcing>[] => [
    {
      value: 'INTERNAL_LASER',
      icon: 'flare',
      titleKey: 'PLANNING_NEW.ANGLE_SOURCING_INTERNAL',
      subtitleKey: 'PLANNING_NEW.ANGLE_SOURCING_INTERNAL_CARD_SUB',
      emphKey: 'PLANNING_NEW.ANGLE_SOURCING_INTERNAL_CARD_EMPH',
      hintKey: 'PLANNING_NEW.ANGLE_SOURCING_INTERNAL_CARD_HINT',
    },
    {
      value: 'EXTERNAL_SUPPLIER',
      icon: 'local_shipping',
      titleKey: 'PLANNING_NEW.ANGLE_SOURCING_EXTERNAL',
      subtitleKey: 'PLANNING_NEW.ANGLE_SOURCING_EXTERNAL_CARD_SUB',
      emphKey: 'PLANNING_NEW.ANGLE_SOURCING_EXTERNAL_CARD_EMPH',
      hintKey: 'PLANNING_NEW.ANGLE_SOURCING_EXTERNAL_CARD_HINT',
    },
    {
      value: 'NO_LASER',
      icon: 'block',
      titleKey: 'PLANNING_NEW.ANGLE_SOURCING_NONE',
      subtitleKey: 'PLANNING_NEW.ANGLE_SOURCING_NONE_CARD_SUB',
      emphKey: 'PLANNING_NEW.ANGLE_SOURCING_NONE_CARD_EMPH',
      hintKey: 'PLANNING_NEW.ANGLE_SOURCING_NONE_CARD_HINT',
    },
  ]);

  /** וריאנט הפרויקט הנבחר (טיוטה / אחרי יצירה) */
  selectedVariantOrder(): {
    lineMaterial: ProjectLineMaterial;
    machiningRoute: ProjectMachiningRoute;
  } {
    const pid = this.selectedProjectId();
    if (pid) {
      const d = this.drafts().find((x) => x.id === pid);
      if (d) {
        return {
          lineMaterial: d.lineMaterial,
          machiningRoute: d.machiningRoute,
        };
      }
    }
    return {
      lineMaterial: this.lineMaterial(),
      machiningRoute: this.machiningRoute(),
    };
  }

  station1FlowLabelKey(): string {
    return stationLabelKey(this.selectedVariantOrder(), 1);
  }

  station1ManagerSectionKey(): string {
    return planningStation1ManagerSectionKey(this.selectedVariantOrder());
  }

  createProjectAndGoStep2(): void {
    const name = this.newProjectName().trim();
    if (name.length < 2) {
      this.createErrorKey.set('PLANNING_NEW.WIZARD_NAME_MIN');
      return;
    }
    this.creating.set(true);
    this.createErrorKey.set(null);
    const details = this.newProjectDetails().trim();
    this.api
      .postPlanningDraft({
        name,
        requirements: details || undefined,
        lineMaterial: this.lineMaterial(),
        machiningRoute: this.machiningRoute(),
        angleSourcing: this.angleSourcing(),
        projectManagerUserId: this.selectedProjectManagerId() || undefined,
      })
      .pipe(
        take(1),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (o) => {
          this.selectedProjectId.set(o.id);
          this.selectedFlow.set(o.flowStatus);
          this.selectedName.set(o.name);
          this.step.set(2);
          this.reloadDrafts();
        },
        error: () =>
          this.createErrorKey.set('PLANNING_NEW.WIZARD_CREATE_FAILED'),
      });
  }

  goStep3(): void {
    this.step.set(3);
    if (!this.assignees().length && !this.assigneesLoading()) {
      this.loadAssignees();
    }
    this.loadWorkCycles();
  }

  /** מפופאפ החזיתות: מעבר לשלב 3 ופתיחת פופאפ השיבוץ ליחידה שנבחרה. */
  onLaunchUnit(windowTypeId: string): void {
    this.pendingLaunchWindowTypeId.set(windowTypeId);
    this.goStep3();
  }

  goStep2(): void {
    this.step.set(2);
  }

  private loadAssignees(): void {
    this.assigneesLoading.set(true);
    this.assigneesLoadError.set(null);
    this.api
      .getPlanningAssignees()
      .pipe(
        take(1),
        finalize(() => this.assigneesLoading.set(false)),
      )
      .subscribe({
        next: (list) => {
          this.assigneePhotoFailedIds.set(new Set());
          this.assignees.set(list);
        },
        error: () =>
          this.assigneesLoadError.set('PLANNING_NEW.WIZARD_ASSIGNEES_FAILED'),
      });
  }

  private loadWorkCycles(): void {
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.workCyclesLoading.set(true);
    this.workCyclesError.set(null);
    this.api
      .getWorkCycles(pid)
      .pipe(
        take(1),
        finalize(() => this.workCyclesLoading.set(false)),
      )
      .subscribe({
        next: (cycles) => {
          this.workCycles.set(cycles);
          if (
            this.step() === 3 &&
            !cycles.some((cycle) => this.hasInstructions(cycle))
          ) {
            this.step.set(2);
            return;
          }
          const pendingWt = this.pendingLaunchWindowTypeId();
          if (pendingWt) {
            const unit = cycles.find((c) => c.windowTypeId === pendingWt);
            this.pendingLaunchWindowTypeId.set(null);
            if (unit) {
              this.openCycleAssignModal(unit);
              return;
            }
          }
          const cur = this.selectedCycleId();
          if (cur) {
            const still = cycles.find((c) => c.id === cur);
            if (still) this.selectCycle(still);
          }
        },
        error: () =>
          this.workCyclesError.set('PLANNING_NEW.WIZARD_CYCLES_FAILED'),
      });
  }

  setUnitSearch(value: string): void {
    this.unitSearchQuery.set(value);
  }

  setUnitStatusFilter(value: string | number | null): void {
    const v = value == null ? 'all' : String(value);
    if (
      v === 'all' ||
      v === 'DRAFT' ||
      v === 'OPEN' ||
      v === 'IN_PROGRESS' ||
      v === 'COMPLETED' ||
      v === 'RETURNED'
    ) {
      this.unitStatusFilter.set(v);
    }
  }

  unitStatusFilterOptions(): UiSelectOption<UnitStatusFilter>[] {
    const statuses: WorkCycleStatus[] = [
      'DRAFT',
      'OPEN',
      'IN_PROGRESS',
      'COMPLETED',
      'RETURNED',
    ];
    return [
      {
        value: 'all',
        label: this.translate.instant('PLANNING_NEW.UNIT_FILTER_ALL'),
      },
      ...statuses.map((status) => ({
        value: status,
        label: this.translate.instant(this.cycleStatusKey(status)),
      })),
    ];
  }

  private resetUnitFilters(): void {
    this.unitStatusFilter.set('all');
    this.unitSearchQuery.set('');
  }

  /** A unit appears in step 3 once production instructions were uploaded. */
  hasInstructions(c: WorkCycle): boolean {
    return !!c.windowType.instructionDocId;
  }

  isDraftUnit(c: WorkCycle): boolean {
    return c.status === 'DRAFT';
  }

  isLaunchedUnit(c: WorkCycle): boolean {
    return c.status !== 'DRAFT';
  }

  selectedCycle(): WorkCycle | null {
    const id = this.selectedCycleId();
    return this.workCycles().find((c) => c.id === id) ?? null;
  }

  stationsForSelectedCycle(): number[] {
    const stationIds = (this.selectedCycle()?.stationProgress ?? []).map(
      (p) => p.stationId,
    );
    const stationSet = new Set(stationIds);
    const productionOrder = workerFlowSequence(stationSet.has(8));

    return [
      ...productionOrder.filter((id) => stationSet.has(id)),
      ...stationIds.filter((id) => !productionOrder.includes(id)),
    ];
  }

  stationLabelKeyFor(stationId: number): string {
    return stationLabelKey(this.selectedVariantOrder(), stationId);
  }

  stationIconFor(stationId: number): string {
    return stationMatIcon(stationId);
  }

  stationIconFilledFor(stationId: number): boolean {
    return stationMatIconFilled(stationId);
  }

  cycleStatusKey(status: WorkCycleStatus): string {
    return `PLANNING_NEW.CYCLE_STATUS_${status}`;
  }

  assignedWorkerCount(c: WorkCycle): number {
    const ids = new Set(
      c.assignments.filter((a) => a.role === 'WORKER').map((a) => a.userId),
    );
    return ids.size;
  }

  selectCycle(c: WorkCycle): void {
    this.selectedCycleId.set(c.id);
    this.cycleDailyTarget.set(c.dailyTargetQty ?? null);
    this.cycleDailyTargetHours.set(c.dailyTargetHours ?? null);
    const managers: Record<number, string | null> = {};
    const workers: Record<number, string[]> = {};
    for (const p of c.stationProgress) {
      managers[p.stationId] = null;
      workers[p.stationId] = [];
    }
    for (const a of c.assignments) {
      const sid = a.stationId ?? 0;
      if (a.role === 'MANAGER') {
        managers[sid] = a.userId;
      } else {
        workers[sid] = [...(workers[sid] ?? []), a.userId];
      }
    }
    this.cycleStationManager.set(managers);
    this.cycleStationWorkers.set(workers);
    const stations = c.stationProgress.map((p) => p.stationId);
    const curSt = this.selectedAssignStationId();
    if (!curSt || !stations.includes(curSt)) {
      this.selectedAssignStationId.set(stations[0] ?? null);
    }
  }

  openCycleAssignModal(c: WorkCycle): void {
    this.selectCycle(c);
    this.cycleAssignModalOpen.set(true);
  }

  closeCycleAssignModal(): void {
    this.cycleAssignModalOpen.set(false);
  }

  selectAssignStation(stationId: number): void {
    this.selectedAssignStationId.set(stationId);
  }

  activeAssignStationId(): number | null {
    return this.selectedAssignStationId();
  }

  managerOptionsForStation(stationId: number): PlanningAssigneeOptionDto[] {
    return this.assignees().filter(
      (a) => a.role === 'STATION_MANAGER' && a.managedStationId === stationId,
    );
  }

  cycleStationManagerId(stationId: number): string | null {
    return this.cycleStationManager()[stationId] ?? null;
  }

  pickCycleStationManager(stationId: number, id: string | null): void {
    this.cycleStationManager.update((cur) => ({ ...cur, [stationId]: id }));
  }

  isCycleStationWorker(stationId: number, id: string): boolean {
    return (this.cycleStationWorkers()[stationId] ?? []).includes(id);
  }

  toggleCycleStationWorker(stationId: number, id: string): void {
    this.cycleStationWorkers.update((cur) => {
      const list = cur[stationId] ?? [];
      const next = list.includes(id)
        ? list.filter((x) => x !== id)
        : [...list, id];
      return { ...cur, [stationId]: next };
    });
  }

  onCycleDailyTargetInput(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const n = Number(raw);
    this.cycleDailyTarget.set(
      raw.trim().length && Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
    );
  }

  onCycleDailyTargetHoursInput(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const n = Number(raw);
    this.cycleDailyTargetHours.set(
      raw.trim().length && Number.isFinite(n) && n >= 0.25 && n <= 24
        ? Math.round(n * 4) / 4
        : null,
    );
  }

  private buildCycleAssignments(cycle: WorkCycle): WorkCycleAssignmentInput[] {
    const managers = this.cycleStationManager();
    const workers = this.cycleStationWorkers();
    const assignments: WorkCycleAssignmentInput[] = [];
    for (const p of cycle.stationProgress) {
      const sid = p.stationId;
      const mgr = managers[sid];
      if (mgr) assignments.push({ userId: mgr, role: 'MANAGER', stationId: sid });
      for (const w of workers[sid] ?? []) {
        assignments.push({ userId: w, role: 'WORKER', stationId: sid });
      }
    }
    return assignments;
  }

  saveCycleAssignments(): void {
    const pid = this.selectedProjectId();
    const cycle = this.selectedCycle();
    if (!pid || !cycle || cycle.status === 'DRAFT') return;
    const assignments = this.buildCycleAssignments(cycle);
    this.cycleSaving.set(true);
    this.workCyclesError.set(null);
    const target = this.cycleDailyTarget();
    const targetHours = this.cycleDailyTargetHours();
    this.api
      .setWorkCycleAssignments(pid, cycle.id, assignments)
      .pipe(
        concatMap(() =>
          this.api.setWorkCycleDailyTarget(pid, cycle.id, target, targetHours),
        ),
        take(1),
        finalize(() => this.cycleSaving.set(false)),
      )
      .subscribe({
        next: () => {
          this.loadWorkCycles();
          this.closeCycleAssignModal();
        },
        error: () =>
          this.workCyclesError.set('PLANNING_NEW.WIZARD_CYCLE_SAVE_FAILED'),
      });
  }

  launchSelectedCycle(): void {
    const pid = this.selectedProjectId();
    const cycle = this.selectedCycle();
    if (!pid || !cycle || cycle.status !== 'DRAFT') return;
    const assignments = this.buildCycleAssignments(cycle);
    this.cycleLaunching.set(true);
    this.workCyclesError.set(null);
    const target = this.cycleDailyTarget();
    const targetHours = this.cycleDailyTargetHours();
    this.api
      .launchWorkCycle(pid, cycle.id, assignments, target, targetHours)
      .pipe(
        take(1),
        finalize(() => this.cycleLaunching.set(false)),
      )
      .subscribe({
        next: () => {
          this.loadWorkCycles();
          this.closeCycleAssignModal();
        },
        error: () =>
          this.workCyclesError.set('PLANNING_NEW.WIZARD_UNIT_LAUNCH_FAILED'),
      });
  }

  isSawsManager(a: PlanningAssigneeOptionDto): boolean {
    return a.role === 'STATION_MANAGER' && a.managedStationId === 1;
  }

  sawsManagerOptions(): PlanningAssigneeOptionDto[] {
    return this.assignees().filter((a) => this.isSawsManager(a));
  }

  workerOptions(): PlanningAssigneeOptionDto[] {
    return this.assignees().filter((a) => a.role === 'WORKER');
  }

  initialsFor(a: PlanningAssigneeOptionDto): string {
    const f = (a.firstName ?? '').trim();
    const l = (a.lastName ?? '').trim();
    const c1 = f.charAt(0) || '?';
    const c2 = l.charAt(0) || '';
    return (c1 + c2).toUpperCase();
  }

  assigneePhotoVisible(a: PlanningAssigneeOptionDto): boolean {
    const u = a.photoUrl?.trim();
    if (!u) return false;
    return !this.assigneePhotoFailedIds().has(a.id);
  }

  onAssigneePhotoError(id: string): void {
    this.assigneePhotoFailedIds.update((s) => new Set(s).add(id));
  }

  pickSawsManager(id: string | null): void {
    this.selectedSawsManagerId.set(id);
  }

  toggleWorker(id: string): void {
    const cur = this.selectedWorkerIds();
    const i = cur.indexOf(id);
    if (i >= 0) {
      this.selectedWorkerIds.set(cur.filter((_, idx) => idx !== i));
    } else {
      this.selectedWorkerIds.set([...cur, id]);
    }
  }

  clearWorkers(): void {
    this.selectedWorkerIds.set([]);
  }

  isWorkerSelected(id: string): boolean {
    return this.selectedWorkerIds().includes(id);
  }

  resumeDraft(d: PlanningDraftListItemDto): void {
    this.createErrorKey.set(null);
    this.selectedSawsManagerId.set(null);
    this.selectedWorkerIds.set([]);
    this.resetUnitFilters();
    this.selectedProjectId.set(d.id);
    this.applyPick(d);
    this.newProjectName.set(d.name);
    this.newProjectDetails.set(d.requirements?.trim() ?? '');
    this.lineMaterial.set(d.lineMaterial);
    this.machiningRoute.set(d.machiningRoute);
    this.angleSourcing.set(d.angleSourcing ?? 'INTERNAL_LASER');
    this.selectedProjectManagerId.set(d.projectManagerUserId ?? null);
    const hasData = (d.windowTypeCount ?? 0) > 0 || d.itemCount > 0;
    // A project already in production resumes on the upload step so the planner
    // can add more production instructions (each opens a new work cycle).
    const inProduction = d.flowStatus === 'IN_PRODUCTION';
    this.step.set(inProduction ? 2 : hasData ? 3 : 2);
    this.resetCycleSelection();
    if (hasData) {
      this.loadAssignees();
      this.loadWorkCycles();
    }
  }

  private resetCycleSelection(): void {
    this.workCycles.set([]);
    this.selectedCycleId.set(null);
    this.cycleDailyTarget.set(null);
    this.cycleDailyTargetHours.set(null);
    this.cycleStationManager.set({});
    this.cycleStationWorkers.set({});
    this.workCyclesError.set(null);
    this.cycleAssignModalOpen.set(false);
    this.selectedAssignStationId.set(null);
    this.closeUnitDetails();
    this.closeUnitEdit();
    this.closeDeleteUnit();
  }

  // ── Unit card actions: edit / delete / details ────────────────────────────

  /** ניתן לערוך יחידה כל עוד היא לא הושלמה. */
  canEditUnit(c: WorkCycle): boolean {
    return c.status !== 'COMPLETED';
  }

  /** ניתן למחוק רק יחידת טיוטה (לפני שהוצאה לפועל). */
  canDeleteUnit(c: WorkCycle): boolean {
    return c.status === 'DRAFT';
  }

  // ── Details modal ─────────────────────────────────────────────────────────
  readonly detailsOpen = signal(false);
  readonly detailsLoading = signal(false);
  readonly detailsError = signal<string | null>(null);
  readonly details = signal<WorkCycleDetailsDto | null>(null);

  openUnitDetails(c: WorkCycle): void {
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.details.set(null);
    this.detailsError.set(null);
    this.detailsLoading.set(true);
    this.detailsOpen.set(true);
    this.api
      .getWorkCycleDetails(pid, c.id)
      .pipe(
        take(1),
        finalize(() => this.detailsLoading.set(false)),
      )
      .subscribe({
        next: (d) => this.details.set(d),
        error: () => this.detailsError.set('PLANNING_NEW.UNIT_DETAILS_FAILED'),
      });
  }

  closeUnitDetails(): void {
    this.detailsOpen.set(false);
    this.details.set(null);
    this.detailsError.set(null);
  }

  /** יומן הדיווחים של תחנה מסוימת (מתוך פרטי היחידה). */
  logsForStation(stationId: number) {
    return (this.details()?.logs ?? []).filter((l) => l.stationId === stationId);
  }

  // ── Edit modal ────────────────────────────────────────────────────────────
  readonly editOpen = signal(false);
  readonly editLoading = signal(false);
  readonly editSaving = signal(false);
  readonly editUploading = signal(false);
  readonly editError = signal<string | null>(null);
  readonly editCycleId = signal<string | null>(null);
  readonly editWindowTypeId = signal<string | null>(null);
  readonly editWindowCode = signal<string>('');
  readonly editLaunched = signal(false);
  readonly editInstructionUrl = signal<string | null>(null);
  readonly editTotalQty = signal<number>(0);
  readonly editHasAngles = signal(false);
  readonly editComposition = signal<string[]>([]);
  readonly editAngleCodes = signal<string[]>([]);
  readonly editSections = signal<AssemblyWindowPartSection[]>([]);
  readonly editCompDraft = signal('');
  readonly editAngleDraft = signal('');
  private editOriginal: {
    totalQty: number;
    hasAngles: boolean;
    composition: string[];
    angleCodes: string[];
    sections: AssemblyWindowPartSection[];
  } | null = null;

  openUnitEdit(c: WorkCycle): void {
    if (!this.canEditUnit(c)) return;
    const pid = this.selectedProjectId();
    if (!pid) return;
    this.editError.set(null);
    this.editOpen.set(true);
    this.editLoading.set(true);
    this.editCycleId.set(c.id);
    this.api
      .getWorkCycleDetails(pid, c.id)
      .pipe(
        take(1),
        finalize(() => this.editLoading.set(false)),
      )
      .subscribe({
        next: (d) => this.applyEditPrefill(d),
        error: () => this.editError.set('PLANNING_NEW.UNIT_DETAILS_FAILED'),
      });
  }

  private applyEditPrefill(d: WorkCycleDetailsDto): void {
    const wt = d.windowType;
    const sections = (wt.parts?.sections ?? []).map((s) => ({
      key: s.key,
      title: s.title,
      rows: s.rows.map((r) => ({ ...r })),
    }));
    this.editWindowTypeId.set(wt.id);
    this.editWindowCode.set(wt.code);
    this.editLaunched.set(d.cycle.status !== 'DRAFT');
    this.editInstructionUrl.set(wt.instructionPdfUrl);
    this.editTotalQty.set(wt.totalQty);
    this.editHasAngles.set(wt.hasAngles);
    this.editComposition.set([...wt.composition]);
    this.editAngleCodes.set([...wt.angleCodes]);
    this.editSections.set(sections);
    this.editCompDraft.set('');
    this.editAngleDraft.set('');
    this.editOriginal = {
      totalQty: wt.totalQty,
      hasAngles: wt.hasAngles,
      composition: [...wt.composition],
      angleCodes: [...wt.angleCodes],
      sections: JSON.parse(JSON.stringify(sections)) as AssemblyWindowPartSection[],
    };
  }

  closeUnitEdit(): void {
    this.editOpen.set(false);
    this.editCycleId.set(null);
    this.editWindowTypeId.set(null);
    this.editError.set(null);
    this.editOriginal = null;
  }

  onEditQtyInput(ev: Event): void {
    const n = Number((ev.target as HTMLInputElement).value);
    this.editTotalQty.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }

  toggleEditHasAngles(): void {
    this.editHasAngles.update((v) => !v);
  }

  onEditCompDraft(ev: Event): void {
    this.editCompDraft.set((ev.target as HTMLInputElement).value);
  }

  addEditComposition(): void {
    const v = this.editCompDraft().trim();
    if (!v) return;
    this.editComposition.update((list) => [...list, v]);
    this.editCompDraft.set('');
  }

  removeEditComposition(i: number): void {
    this.editComposition.update((list) => list.filter((_, idx) => idx !== i));
  }

  onEditAngleDraft(ev: Event): void {
    this.editAngleDraft.set((ev.target as HTMLInputElement).value);
  }

  addEditAngleCode(): void {
    const v = this.editAngleDraft().trim();
    if (!v) return;
    this.editAngleCodes.update((list) => [...list, v]);
    this.editAngleDraft.set('');
  }

  removeEditAngleCode(i: number): void {
    this.editAngleCodes.update((list) => list.filter((_, idx) => idx !== i));
  }

  updateEditCell(
    si: number,
    ri: number,
    field: 'partNumber' | 'description' | 'blockNumber',
    ev: Event,
  ): void {
    const value = (ev.target as HTMLInputElement).value;
    this.editSections.update((secs) => {
      const next = JSON.parse(JSON.stringify(secs)) as AssemblyWindowPartSection[];
      const row = next[si]?.rows?.[ri];
      if (row) row[field] = value;
      return next;
    });
  }

  updateEditSectionTitle(si: number, ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    this.editSections.update((secs) => {
      const next = JSON.parse(JSON.stringify(secs)) as AssemblyWindowPartSection[];
      if (next[si]) next[si].title = value;
      return next;
    });
  }

  addEditRow(si: number): void {
    this.editSections.update((secs) => {
      const next = JSON.parse(JSON.stringify(secs)) as AssemblyWindowPartSection[];
      next[si]?.rows.push({ partNumber: '', description: '', blockNumber: '' });
      return next;
    });
  }

  removeEditRow(si: number, ri: number): void {
    this.editSections.update((secs) => {
      const next = JSON.parse(JSON.stringify(secs)) as AssemblyWindowPartSection[];
      next[si]?.rows.splice(ri, 1);
      return next;
    });
  }

  addEditSection(): void {
    this.editSections.update((secs) => {
      const next = JSON.parse(JSON.stringify(secs)) as AssemblyWindowPartSection[];
      next.push({ key: 'OTHER', title: '', rows: [] });
      return next;
    });
  }

  removeEditSection(si: number): void {
    this.editSections.update((secs) => {
      const next = JSON.parse(JSON.stringify(secs)) as AssemblyWindowPartSection[];
      next.splice(si, 1);
      return next;
    });
  }

  /** העלאת קובץ הוראות ייצור חדש ליחידה (מסלול "החלף PDF"). */
  onEditPdfSelected(kind: 'WINDOW_INSTRUCTION_PDF', fileList: FileList | null): void {
    const file = fileList && fileList.length ? fileList[0] : null;
    const pid = this.selectedProjectId();
    const wtId = this.editWindowTypeId();
    const cycleId = this.editCycleId();
    if (!file || !pid || !wtId || !cycleId) return;
    this.editUploading.set(true);
    this.editError.set(null);
    this.api
      .uploadWindowTypePdf(pid, wtId, file, kind)
      .pipe(
        concatMap(() =>
          this.editLaunched()
            ? this.api.editWorkCycleWindow(pid, cycleId, { fullReroute: true })
            : this.api.getWorkCycles(pid),
        ),
        take(1),
        finalize(() => this.editUploading.set(false)),
      )
      .subscribe({
        next: () => {
          this.loadWorkCycles();
          this.closeUnitEdit();
        },
        error: () => this.editError.set('PLANNING_NEW.UNIT_EDIT_FAILED'),
      });
  }

  private buildEditBody(): EditWorkCycleWindowBody {
    const body: EditWorkCycleWindowBody = {};
    const orig = this.editOriginal;
    if (!orig) return body;
    if (this.editTotalQty() !== orig.totalQty) body.totalQty = this.editTotalQty();
    if (this.editHasAngles() !== orig.hasAngles)
      body.hasAngles = this.editHasAngles();
    if (!this.sameArr(this.editComposition(), orig.composition))
      body.composition = this.editComposition();
    if (!this.sameArr(this.editAngleCodes(), orig.angleCodes))
      body.angleCodes = this.editAngleCodes();
    if (
      JSON.stringify(this.editSections()) !== JSON.stringify(orig.sections)
    )
      body.sections = this.editSections();
    return body;
  }

  private sameArr(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  hasEditChanges(): boolean {
    return Object.keys(this.buildEditBody()).length > 0;
  }

  saveEdit(): void {
    const pid = this.selectedProjectId();
    const cycleId = this.editCycleId();
    if (!pid || !cycleId) return;
    const body = this.buildEditBody();
    if (!Object.keys(body).length) {
      this.closeUnitEdit();
      return;
    }
    this.editSaving.set(true);
    this.editError.set(null);
    this.api
      .editWorkCycleWindow(pid, cycleId, body)
      .pipe(
        take(1),
        finalize(() => this.editSaving.set(false)),
      )
      .subscribe({
        next: () => {
          this.loadWorkCycles();
          this.closeUnitEdit();
        },
        error: () => this.editError.set('PLANNING_NEW.UNIT_EDIT_FAILED'),
      });
  }

  // ── Delete confirmation ─────────────────────────────────────────────────────
  readonly deleteOpen = signal(false);
  readonly deleteCycleId = signal<string | null>(null);
  readonly deleteCode = signal<string>('');
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  askDeleteUnit(c: WorkCycle): void {
    if (!this.canDeleteUnit(c)) return;
    this.deleteCycleId.set(c.id);
    this.deleteCode.set(c.windowType.code);
    this.deleteError.set(null);
    this.deleteOpen.set(true);
  }

  closeDeleteUnit(): void {
    this.deleteOpen.set(false);
    this.deleteCycleId.set(null);
    this.deleteError.set(null);
  }

  confirmDeleteUnit(): void {
    const pid = this.selectedProjectId();
    const cycleId = this.deleteCycleId();
    if (!pid || !cycleId) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.api
      .deleteWorkCycle(pid, cycleId)
      .pipe(
        take(1),
        finalize(() => this.deleting.set(false)),
      )
      .subscribe({
        next: () => {
          this.loadWorkCycles();
          this.closeDeleteUnit();
        },
        error: () => this.deleteError.set('PLANNING_NEW.UNIT_DELETE_FAILED'),
      });
  }

  panelMode(): 'uploadPreview' | 'summaryApprove' {
    return this.step() === 2 ? 'uploadPreview' : 'summaryApprove';
  }

  onPlanningChanged(): void {
    this.reloadDrafts();
    if (this.step() === 3 && this.selectedProjectId()) {
      this.loadWorkCycles();
    }
  }

  onPlanningApproved(): void {
    this.successSnapshot.set(this.buildSuccessSnapshot());
    this.successModalOpen.set(true);
    this.selectedFlow.set('IN_PRODUCTION');
    this.reloadDrafts();
  }

  private buildSuccessSnapshot(): PlanningSuccessSnapshot {
    const name =
      this.selectedName()?.trim() || this.newProjectName().trim() || '—';
    const notesRaw = this.newProjectDetails().trim();
    const notes = notesRaw.length
      ? notesRaw
      : this.translate.instant('PLANNING_NEW.SUCCESS_NOTES_EMPTY');

    let manager = this.translate.instant('PLANNING_NEW.WIZARD_MANAGER_NONE');
    const mgrId = this.selectedSawsManagerId();
    if (mgrId) {
      const a = this.assignees().find((x) => x.id === mgrId);
      if (a) manager = `${a.firstName} ${a.lastName}`.trim();
    }

    let workers = this.translate.instant('PLANNING_NEW.WIZARD_WORKERS_NONE');
    const wids = this.selectedWorkerIds();
    if (wids.length) {
      const names = wids
        .map((id) => this.assignees().find((a) => a.id === id))
        .filter((a): a is PlanningAssigneeOptionDto => !!a)
        .map((a) => `${a.firstName} ${a.lastName}`.trim());
      if (names.length) workers = names.join(' · ');
    }

    return { name, notes, manager, workers };
  }

  confirmSuccessModal(): void {
    this.successModalOpen.set(false);
    this.successSnapshot.set(null);
    void this.router.navigate(['/admin/projects']);
  }

  cancelSuccessModal(): void {
    this.successModalOpen.set(false);
  }

  startNewWizard(): void {
    this.step.set(1);
    this.selectedProjectId.set(null);
    this.selectedFlow.set(null);
    this.selectedName.set(null);
    this.selectedSawsManagerId.set(null);
    this.selectedWorkerIds.set([]);
    this.resetCycleSelection();
    this.newProjectName.set('');
    this.newProjectDetails.set('');
    this.selectedProjectManagerId.set(null);
    this.lineMaterial.set('ALUMINUM');
    this.machiningRoute.set('GLASS');
    this.angleSourcing.set('INTERNAL_LASER');
    this.createErrorKey.set(null);
    this.assigneesLoadError.set(null);
    this.successModalOpen.set(false);
    this.successSnapshot.set(null);
    this.reloadDrafts();
  }
}
