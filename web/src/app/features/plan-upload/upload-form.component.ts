import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize } from 'rxjs/operators';
import {
  PlanUploadResponseDto,
  PlanUploadService,
} from './plan-upload.service';
import { ItemCardComponent } from './item-card.component';

@Component({
  selector: 'skyflow-upload-form',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ItemCardComponent],
  templateUrl: './upload-form.component.html',
  styleUrl: './upload-form.component.scss',
})
export class UploadFormComponent {
  private readonly planUpload = inject(PlanUploadService);

  readonly selectedFile = signal<File | null>(null);
  readonly analyzing = signal(false);
  readonly previewLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<PlanUploadResponseDto | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly viewMode = signal<'table' | 'cards'>('table');
  readonly cardImageUrls = signal<Record<number, string>>({});

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly saveError = signal<string | null>(null);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.item(0) ?? null;
    this.selectedFile.set(file);
    this.error.set(null);
    this.result.set(null);
    this.cardImageUrls.set({});
    this.resetSaveState();
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode.set(mode);
    if (mode === 'cards') {
      this.loadCardImages();
    }
  }

  private loadCardImages(): void {
    const analysis = this.result();
    if (!analysis) return;
    analysis.bomData.items.forEach((item, index) => {
      if (!item.drawingImageUrl || this.cardImageUrls()[index]) return;
      this.planUpload.getDrawingPreview(item.drawingImageUrl).subscribe({
        next: ({ url }) =>
          this.cardImageUrls.update((map) => ({ ...map, [index]: url })),
        error: () => undefined,
      });
    });
  }

  submit(): void {
    const file = this.selectedFile();
    if (!file) {
      this.error.set('UPLOAD_PLAN.ERROR_NO_FILE');
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.error.set('UPLOAD_PLAN.ERROR_INVALID_FILE');
      return;
    }

    this.error.set(null);
    this.result.set(null);
    this.analyzing.set(true);
    this.resetSaveState();

    this.planUpload
      .uploadPlan(file)
      .pipe(finalize(() => this.analyzing.set(false)))
      .subscribe({
        next: (response) => {
          this.result.set(response);
          this.cardImageUrls.set({});
          if (this.viewMode() === 'cards') {
            this.loadCardImages();
          }
        },
        error: (err: unknown) => {
          const message = this.resolveErrorKey(err);
          this.error.set(message);
        },
      });
  }

  private resolveErrorKey(err: unknown): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.message === 'string') {
      return err.error.message;
    }
    return 'UPLOAD_PLAN.ERROR_GENERIC';
  }

  openDrawingPreview(objectUrl: string): void {
    if (!objectUrl) return;
    this.previewLoading.set(true);
    this.error.set(null);
    this.planUpload
      .getDrawingPreview(objectUrl)
      .pipe(finalize(() => this.previewLoading.set(false)))
      .subscribe({
        next: ({ url }) => this.previewUrl.set(url),
        error: (err: unknown) => {
          const message = this.resolveErrorKey(err);
          this.error.set(message);
        },
      });
  }

  closePreview(): void {
    this.previewUrl.set(null);
  }

  savePurchaseOrder(): void {
    const analysis = this.result();
    if (!analysis || this.saving() || this.saved()) return;

    this.saving.set(true);
    this.saveError.set(null);

    this.planUpload
      .savePurchaseOrder({
        projectName: analysis.projectName,
        s3Url: analysis.s3Url,
        bomData: analysis.bomData,
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.saved.set(true),
        error: (err: unknown) => this.saveError.set(this.resolveErrorKey(err)),
      });
  }

  private resetSaveState(): void {
    this.saving.set(false);
    this.saved.set(false);
    this.saveError.set(null);
  }
}
