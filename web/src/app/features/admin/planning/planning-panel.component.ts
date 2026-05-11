import { NgClass } from '@angular/common';
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
  PlanningWizardPanelMode,
  ProjectFlowStatus,
} from '../../../core/skyflow.models';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

function httpErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { error?: { message?: string | string[] } })?.error;
  const m = body?.message;
  if (Array.isArray(m) && m.length) return String(m[0]);
  if (typeof m === 'string' && m.length) return m;
  return fallback;
}

@Component({
  selector: 'skyflow-planning-panel',
  imports: [TranslateModule, NgClass],
  templateUrl: './planning-panel.component.html',
  styleUrl: './planning-panel.component.scss',
})
export class PlanningPanelComponent {
  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);

  private normalizePreview(p: PlanningParsePreviewDto): PlanningParsePreviewDto {
    return { ...p, sheets: p.sheets ?? [] };
  }

  readonly projectId = input<string | null>(null);
  readonly flowStatus = input<ProjectFlowStatus | null>(null);
  /** לכותרת דוח PDF */
  readonly projectName = input<string | null>(null);
  /** מצב אשף: ברירת מחדל = מסך מלא; uploadPreview = שלב העלאה; summaryApprove = שלב אישור */
  readonly wizardMode = input<PlanningWizardPanelMode>('default');
  /** כותרת ותת־כותרת של הפאנל */
  readonly panelHeader = input(true);
  /** משתמש משויך בעת אישור (שלב 3) */
  readonly assigneeUserId = input<string | null>(null);

  readonly planningChanged = output<void>();
  readonly projectCreated = output<string>();
  readonly wizardContinue = output<void>();

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
        next: (p) => {
          if (this.projectId() !== id) return;
          const cur = this.preview();
          const empty = !p?.itemCount;
          if (
            empty &&
            cur &&
            cur.projectId === id &&
            (cur.itemCount ?? 0) > 0
          ) {
            return;
          }
          this.preview.set(empty ? null : this.normalizePreview(p));
        },
        error: () => {
          if (this.projectId() === id) this.preview.set(null);
        },
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
        error: (err) => this.error.set(httpErrorMessage(err, 'Could not create project')),
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
        this.error.set(httpErrorMessage(err, 'Upload or parse failed'));
      },
    });
  }

  exportPdf(): void {
    const pv = this.preview();
    if (!pv?.itemCount) return;
    const name = this.projectName()?.trim() || pv.projectId;
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const t = (k: string) => esc(this.translate.instant(k));
    const sheets = pv.sheets ?? [];
    let body = '';
    for (const tab of sheets) {
      body += `<section class="sheet"><h2>${esc(tab.sheetName)}</h2><p class="meta">${t('PLANNING.TYPE_UNIT')} ${tab.unitCount} · ${t('PLANNING.TYPE_WINDOW')} ${tab.windowCount} · ${tab.itemCount} ${t('PLANNING.LINES_SHORT')}</p>`;
      for (const row of tab.rows) {
        const pt =
          row.productType === 'WINDOW'
            ? t('PLANNING.TYPE_WINDOW')
            : t('PLANNING.TYPE_UNIT');
        const lines = row.componentLines
          .map((line) => `<li>${esc(line)}</li>`)
          .join('');
        body += `<article class="row"><h3>${esc(row.displayLabel)}</h3><p><strong>${t('PLANNING.COL_INSTRUCTION')}</strong> ${esc(row.instructionKind)} · <strong>${t('PLANNING.COL_PRODUCT')}</strong> ${pt} · <strong>${t('PLANNING.COL_COMP_TOTAL')}</strong> ${row.componentCount}</p><ul>${lines}</ul></article>`;
      }
      body += `</section>`;
    }
    const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><title>${t('PLANNING.PDF_DOC_TITLE')}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;padding:1.2rem;line-height:1.45;color:#111}
h1{font-size:1.35rem;margin:0 0 .5rem}
.sub{color:#444;font-size:.9rem;margin-bottom:1.25rem}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem;margin:1rem 0 1.5rem}
.kpi div{border:1px solid #ccc;border-radius:10px;padding:.65rem;text-align:center}
.kpi strong{display:block;font-size:1.55rem;margin-top:.25rem}
.sheet{margin-top:1.5rem;page-break-inside:avoid}
.sheet h2{font-size:1.1rem;border-bottom:2px solid #0ea5e9;padding-bottom:.35rem}
.meta{font-size:.85rem;color:#555;margin:.35rem 0 .75rem}
.row{border:1px solid #ddd;border-radius:10px;padding:.75rem;margin:.5rem 0;background:#fafafa}
.row h3{margin:0 0 .4rem;font-size:1rem}
.row ul{margin:.4rem 0 0;padding-right:1.1rem;font-size:.78rem;font-family:ui-monospace,monospace}
@media print{body{padding:.5rem}.kpi{grid-template-columns:repeat(4,1fr)}}
</style></head><body>
<h1>${t('PLANNING.PDF_HEADING')}</h1>
<p class="sub">${esc(name)} · ${esc(new Date().toLocaleString())}</p>
<div class="kpi">
<div>${t('PLANNING.COL_UNITS')}<strong>${pv.totalUnits}</strong></div>
<div>${t('PLANNING.COL_WINDOWS')}<strong>${pv.totalWindows}</strong></div>
<div>${t('PLANNING.COL_COMPONENTS')}<strong>${pv.totalComponents}</strong></div>
<div>${t('PLANNING.COL_LINES')}<strong>${pv.itemCount}</strong></div>
</div>
${body || `<p>${t('PLANNING.PDF_NO_SHEETS')}</p>`}
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
    }, 250);
  }

  onWizardContinue(): void {
    this.wizardContinue.emit();
  }

  approve(): void {
    const id = this.projectId();
    if (!id) return;
    this.approving.set(true);
    this.error.set(null);
    this.api
      .postApprovePlanning(id, {
        assigneeUserId: this.assigneeUserId() ?? null,
      })
      .pipe(
        take(1),
        finalize(() => this.approving.set(false)),
      )
      .subscribe({
        next: () => {
          this.planningChanged.emit();
        },
        error: (err) => {
          this.error.set(httpErrorMessage(err, 'Approval failed'));
        },
      });
  }
}
