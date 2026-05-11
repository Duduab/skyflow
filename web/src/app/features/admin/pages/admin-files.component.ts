import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, map, switchMap, take } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import { AdminDashboard, ProjectDocumentKind } from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';

@Component({
  selector: 'skyflow-admin-files',
  imports: [TranslateModule, DatePipe],
  templateUrl: './admin-files.component.html',
  styleUrl: './admin-files.component.scss',
})
export class AdminFilesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly lang = inject(LanguageService);

  readonly docFile = viewChild<ElementRef<HTMLInputElement>>('docFile');

  readonly loading = signal(true);
  readonly data = signal<AdminDashboard | null>(null);

  readonly uploadMode = signal<'existing' | 'new'>('existing');
  readonly selectedProjectId = signal('');
  readonly newProjectName = signal('');
  readonly docKind = signal<ProjectDocumentKind>('WORK_ORDER');
  readonly uploadTitle = signal('');
  readonly uploadReference = signal('');
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly uploadOk = signal(false);

  ngOnInit(): void {
    this.loadDashboard();
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  private loadDashboard(): void {
    this.loading.set(true);
    this.api
      .getAdminDashboard(null)
      .pipe(take(1))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
          const cur = this.selectedProjectId();
          const exists = cur && d.projects.some((p) => p.id === cur);
          if (!exists && d.projects[0]) {
            this.selectedProjectId.set(d.projects[0].id);
          }
        },
        error: () => this.loading.set(false),
      });
  }

  setUploadMode(mode: 'existing' | 'new'): void {
    this.uploadMode.set(mode);
    this.uploadError.set(null);
    this.uploadOk.set(false);
  }

  onProjectSelect(value: string): void {
    this.selectedProjectId.set(value);
    this.uploadError.set(null);
  }

  onDocKindSelect(value: string): void {
    this.docKind.set(value === 'PURCHASE_ORDER' ? 'PURCHASE_ORDER' : 'WORK_ORDER');
  }

  submitUpload(): void {
    const input = this.docFile()?.nativeElement;
    const file = input?.files?.[0];
    this.uploadError.set(null);
    this.uploadOk.set(false);

    if (!file) {
      this.uploadError.set('ADMIN_FILES_PAGE.UPLOAD_ERR_NO_FILE');
      return;
    }

    const kind = this.docKind();
    const title = this.uploadTitle().trim();
    const reference = this.uploadReference().trim();

    this.uploading.set(true);

    if (this.uploadMode() === 'new') {
      const name = this.newProjectName().trim();
      if (name.length < 2) {
        this.uploading.set(false);
        this.uploadError.set('ADMIN_FILES_PAGE.UPLOAD_ERR_BAD_NAME');
        return;
      }
      this.api
        .postPlanningDraft(name)
        .pipe(
          switchMap((proj) =>
            this.api
              .postProjectDocument(proj.id, file, {
                kind,
                title: title || undefined,
                reference: reference || undefined,
              })
              .pipe(map(() => proj.id)),
          ),
          finalize(() => this.uploading.set(false)),
          take(1),
        )
        .subscribe({
          next: (newProjectId) => {
            this.uploadOk.set(true);
            this.newProjectName.set('');
            this.uploadTitle.set('');
            this.uploadReference.set('');
            this.selectedProjectId.set(newProjectId);
            if (input) input.value = '';
            this.setUploadMode('existing');
            this.loadDashboard();
          },
          error: (err) => this.uploadError.set(this.errKey(err)),
        });
      return;
    }

    const projectId = this.selectedProjectId();
    if (!projectId) {
      this.uploading.set(false);
      this.uploadError.set('ADMIN_FILES_PAGE.UPLOAD_ERR_NO_PROJECT');
      return;
    }

    this.api
      .postProjectDocument(projectId, file, {
        kind,
        title: title || undefined,
        reference: reference || undefined,
      })
      .pipe(finalize(() => this.uploading.set(false)), take(1))
      .subscribe({
        next: () => {
          this.uploadOk.set(true);
          this.uploadTitle.set('');
          this.uploadReference.set('');
          if (input) input.value = '';
          this.loadDashboard();
        },
        error: (err) => this.uploadError.set(this.errKey(err)),
      });
  }

  private errKey(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const msg =
        typeof err.error === 'object' && err.error && 'message' in err.error
          ? String((err.error as { message: unknown }).message)
          : err.message;
      if (/pdf/i.test(msg)) return 'ADMIN_FILES_PAGE.UPLOAD_ERR_PDF';
      if (err.status === 413) return 'ADMIN_FILES_PAGE.UPLOAD_ERR_TOO_LARGE';
      if (err.status === 404) return 'ADMIN_FILES_PAGE.UPLOAD_ERR_NOT_FOUND';
    }
    return 'ADMIN_FILES_PAGE.UPLOAD_ERR_GENERIC';
  }
}
