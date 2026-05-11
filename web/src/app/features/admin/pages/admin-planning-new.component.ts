import { Component, inject, OnInit, signal } from '@angular/core';
import { finalize, take } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  PlanningDraftListItemDto,
  ProjectFlowStatus,
} from '../../../core/skyflow.models';
import { PlanningPanelComponent } from '../planning/planning-panel.component';

@Component({
  selector: 'skyflow-admin-planning-new',
  standalone: true,
  imports: [TranslateModule, PlanningPanelComponent],
  templateUrl: './admin-planning-new.component.html',
  styleUrl: './admin-planning-new.component.scss',
})
export class AdminPlanningNewComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly loading = signal(true);
  readonly listError = signal<string | null>(null);
  readonly drafts = signal<PlanningDraftListItemDto[]>([]);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedFlow = signal<ProjectFlowStatus | null>(null);
  readonly selectedName = signal<string | null>(null);

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
          const cur = this.selectedProjectId();
          if (cur && rows.some((r) => r.id === cur)) {
            const r = rows.find((x) => x.id === cur)!;
            this.applyPick(r);
            return;
          }
          const first = rows[0];
          if (first) {
            this.selectedProjectId.set(first.id);
            this.applyPick(first);
          } else {
            this.selectedProjectId.set(null);
            this.selectedFlow.set(null);
            this.selectedName.set(null);
          }
        },
        error: () => this.listError.set('PLANNING_NEW.LOAD_LIST_FAILED'),
      });
  }

  private applyPick(r: PlanningDraftListItemDto): void {
    this.selectedFlow.set(r.flowStatus);
    this.selectedName.set(r.name);
  }

  onPickerChange(value: string): void {
    if (!value) {
      this.selectedProjectId.set(null);
      this.selectedFlow.set(null);
      this.selectedName.set(null);
      return;
    }
    const r = this.drafts().find((x) => x.id === value);
    this.selectedProjectId.set(value);
    if (r) this.applyPick(r);
  }

  onPlanningChanged(): void {
    this.reloadDrafts();
  }

  onProjectCreated(id: string): void {
    this.selectedProjectId.set(id);
    this.reloadDrafts();
  }
}
