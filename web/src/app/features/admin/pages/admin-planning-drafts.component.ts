import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [TranslateModule, RouterLink, DatePipe, DecimalPipe],
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

  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  readonly editSaving = signal(false);
  readonly editError = signal<string | null>(null);

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

  startEdit(d: PlanningDraftListItemDto, ev?: Event): void {
    ev?.stopPropagation();
    this.editingId.set(d.id);
    this.editName.set(d.name);
    this.editError.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editName.set('');
    this.editError.set(null);
  }

  onEditNameInput(ev: Event): void {
    this.editName.set((ev.target as HTMLInputElement).value);
    this.editError.set(null);
  }

  saveEdit(): void {
    const id = this.editingId();
    if (!id) return;
    const name = this.editName().trim();
    if (name.length < 2) {
      this.editError.set('PLANNING_NEW.WIZARD_NAME_MIN');
      return;
    }
    this.editSaving.set(true);
    this.editError.set(null);
    this.api
      .patchPlanningDraft(id, name)
      .pipe(
        take(1),
        finalize(() => this.editSaving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.drafts.update((rows) =>
            rows.map((r) => (r.id === updated.id ? updated : r)),
          );
          this.cancelEdit();
        },
        error: () => this.editError.set('ADMIN_PLANNING_DRAFTS.EDIT_FAILED'),
      });
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
          if (this.editingId() === d.id) this.cancelEdit();
          this.deleteTarget.set(null);
        },
        error: () => this.listError.set('ADMIN_PLANNING_DRAFTS.DELETE_FAILED'),
      });
  }

  stepLabelKey(d: PlanningDraftListItemDto): string {
    return planningDraftStepLabelKey(d);
  }
}
