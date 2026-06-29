import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconComponent } from '../../../shared/mat-icon/mat-icon.component';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiCardActionComponent } from '../../../shared/ui-card-action/ui-card-action.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, take } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import { PlanningDraftListItemDto } from '../../../core/skyflow.models';
import {
  planningDraftStepLabelKey,
  PlanningDraftViewMode,
} from './planning-draft.util';

@Component({
  selector: 'skyflow-admin-planning-drafts',
  standalone: true,
  imports: [TranslateModule, RouterLink, DatePipe, DecimalPipe, UiButtonComponent, UiPopupComponent, MatIconComponent, UiCardActionComponent],
  templateUrl: './admin-planning-drafts.component.html',
  styleUrl: './admin-planning-drafts.component.scss',
})
export class AdminPlanningDraftsComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly loading = signal(true);
  readonly listError = signal<string | null>(null);
  readonly drafts = signal<PlanningDraftListItemDto[]>([]);
  readonly searchQuery = signal('');
  readonly viewMode = signal<PlanningDraftViewMode>('cards');

  readonly deleteTarget = signal<PlanningDraftListItemDto | null>(null);
  readonly deleteBusy = signal(false);

  readonly filteredDrafts = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const rows = this.drafts();
    if (!q) return rows;
    return rows.filter((d) => d.name.toLowerCase().includes(q));
  });

  readonly stats = computed(() => {
    const rows = this.drafts();
    const withFile = rows.filter((d) => d.itemCount > 0).length;
    return {
      total: rows.length,
      withFile,
      awaitingFile: rows.length - withFile,
    };
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.listError.set(null);
    this.api
      .getPlanningDraftsList()
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (rows) => this.drafts.set(rows),
        error: () => this.listError.set('ADMIN_PLANNING_DRAFTS.LOAD_FAILED'),
      });
  }

  setSearch(value: string): void {
    this.searchQuery.set(value);
  }

  setViewMode(mode: PlanningDraftViewMode): void {
    this.viewMode.set(mode);
  }

  openDeleteConfirm(d: PlanningDraftListItemDto, ev?: Event): void {
    ev?.stopPropagation();
    this.deleteTarget.set(d);
  }

  closeDeleteConfirm(): void {
    if (this.deleteBusy()) return;
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const d = this.deleteTarget();
    if (!d) return;
    this.deleteBusy.set(true);
    this.api
      .deletePlanningDraft(d.id)
      .pipe(
        take(1),
        finalize(() => this.deleteBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.drafts.update((rows) => rows.filter((r) => r.id !== d.id));
          this.deleteTarget.set(null);
        },
        error: () => this.listError.set('ADMIN_PLANNING_DRAFTS.DELETE_FAILED'),
      });
  }

  stepLabelKey(d: PlanningDraftListItemDto): string {
    return planningDraftStepLabelKey(d);
  }
}
