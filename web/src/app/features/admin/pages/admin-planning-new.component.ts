import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { concatMap, finalize, take } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  PlanningAssigneeOptionDto,
  PlanningDraftListItemDto,
  ProjectAngleSourcing,
  ProjectFlowStatus,
  ProjectLineMaterial,
  ProjectMachiningRoute,
  WorkCycle,
  WorkCycleAssignmentInput,
  WorkCycleStatus,
} from '../../../core/skyflow.models';
import {
  planningStation1ManagerSectionKey,
  stationLabelKey,
} from '../../../core/station-presentation';
import { PlanningPdfPanelComponent } from '../planning/planning-pdf-panel.component';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';

type WizardStep = 1 | 2 | 3;

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
    TranslateModule,
    PlanningPdfPanelComponent,
    UiButtonComponent,
    UiPopupComponent,
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

  /** A unit appears in step 3 once production instructions were uploaded. */
  hasInstructions(c: WorkCycle): boolean {
    return !!c.windowType.instructionDocId;
  }

  unitsForAssignment(): WorkCycle[] {
    return this.workCycles().filter((c) => this.hasInstructions(c));
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
    return (this.selectedCycle()?.stationProgress ?? []).map((p) => p.stationId);
  }

  stationLabelKeyFor(stationId: number): string {
    return stationLabelKey(this.selectedVariantOrder(), stationId);
  }

  cycleStatusKey(status: WorkCycleStatus): string {
    return `PLANNING_NEW.CYCLE_STATUS_${status}`;
  }

  selectCycle(c: WorkCycle): void {
    this.selectedCycleId.set(c.id);
    this.cycleDailyTarget.set(c.dailyTargetQty ?? null);
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
    this.api
      .setWorkCycleAssignments(pid, cycle.id, assignments)
      .pipe(
        concatMap(() =>
          this.api.setWorkCycleDailyTarget(pid, cycle.id, target),
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
    this.api
      .launchWorkCycle(pid, cycle.id, assignments, target)
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
    this.cycleStationManager.set({});
    this.cycleStationWorkers.set({});
    this.workCyclesError.set(null);
    this.cycleAssignModalOpen.set(false);
    this.selectedAssignStationId.set(null);
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
