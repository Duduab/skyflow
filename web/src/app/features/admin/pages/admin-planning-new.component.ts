import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, take } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  PlanningAssigneeOptionDto,
  PlanningDraftListItemDto,
  ProjectAngleSourcing,
  ProjectFlowStatus,
  ProjectLineMaterial,
  ProjectMachiningRoute,
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

  ngOnInit(): void {
    this.reloadDrafts();
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
            this.newProjectName.set('');
            this.newProjectDetails.set('');
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
    const hasData = (d.windowTypeCount ?? 0) > 0 || d.itemCount > 0;
    this.step.set(hasData ? 3 : 2);
    if (hasData) {
      this.loadAssignees();
    }
  }

  panelMode(): 'uploadPreview' | 'summaryApprove' {
    return this.step() === 2 ? 'uploadPreview' : 'summaryApprove';
  }

  onPlanningChanged(): void {
    this.reloadDrafts();
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
    this.newProjectName.set('');
    this.newProjectDetails.set('');
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
