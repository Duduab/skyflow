import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { finalize, take } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import {
  PlanningParsePreviewDto,
  ProjectFlowStatus,
} from '../../../core/skyflow.models';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'skyflow-planning-panel',
  imports: [TranslateModule],
  templateUrl: './planning-panel.component.html',
  styleUrl: './planning-panel.component.scss',
})
export class PlanningPanelComponent {
  private readonly api = inject(ApiService);

  private normalizePreview(p: PlanningParsePreviewDto): PlanningParsePreviewDto {
    return { ...p, sheets: p.sheets ?? [] };
  }

  readonly projectId = input<string | null>(null);
  readonly flowStatus = input<ProjectFlowStatus | null>(null);

  readonly planningChanged = output<void>();
  readonly projectCreated = output<string>();

  readonly newProjectName = signal('');
  readonly creating = signal(false);
  readonly uploading = signal(false);
  readonly approving = signal(false);
  readonly error = signal<string | null>(null);
  readonly preview = signal<PlanningParsePreviewDto | null>(null);
  readonly dragOver = signal(false);

  constructor() {
    effect((onCleanup) => {
      const id = this.projectId();
      const flow = this.flowStatus();
      if (!id || flow !== 'PENDING_PLANNING') {
        this.preview.set(null);
        return;
      }
      const sub = this.api.getPlanningPreview(id).subscribe({
        next: (p) =>
          this.preview.set(
            p.itemCount ? this.normalizePreview(p) : null,
          ),
        error: () => this.preview.set(null),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  createDraft(): void {
    const name = this.newProjectName().trim();
    if (name.length < 2) {
      this.error.set('Enter a project name (at least 2 characters)');
      return;
    }
    this.creating.set(true);
    this.error.set(null);
    this.api
      .postPlanningDraft(name)
      .pipe(
        take(1),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (o) => {
          this.newProjectName.set('');
          this.projectCreated.emit(o.id);
        },
        error: () => this.error.set('Could not create project'),
      });
  }

  onNameInput(ev: Event): void {
    this.newProjectName.set((ev.target as HTMLInputElement).value);
  }

  onFileSelected(fileList: FileList | null): void {
    const file = fileList?.item(0);
    if (file) this.uploadFile(file);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    const file = ev.dataTransfer?.files?.item(0);
    if (file) this.uploadFile(file);
  }

  private uploadFile(file: File): void {
    const id = this.projectId();
    if (!id) return;
    this.uploading.set(true);
    this.error.set(null);
    this.api.postPlanningUpload(id, file).subscribe({
      next: (p) => {
        this.preview.set(this.normalizePreview(p));
        this.uploading.set(false);
        this.planningChanged.emit();
      },
      error: (err) => {
        this.uploading.set(false);
        const msg =
          err?.error?.message?.[0] ??
          err?.error?.message ??
          'Upload or parse failed';
        this.error.set(typeof msg === 'string' ? msg : 'Upload failed');
      },
    });
  }

  approve(): void {
    const id = this.projectId();
    if (!id) return;
    this.approving.set(true);
    this.error.set(null);
    this.api
      .postApprovePlanning(id)
      .pipe(
        take(1),
        finalize(() => this.approving.set(false)),
      )
      .subscribe({
        next: () => {
          this.planningChanged.emit();
        },
        error: (err) => {
          const msg =
            err?.error?.message?.[0] ??
            err?.error?.message ??
            'Approval failed';
          this.error.set(typeof msg === 'string' ? msg : 'Approval failed');
        },
      });
  }
}
