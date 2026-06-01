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
  PlanningPreviewComponentCardDto,
  PlanningPreviewLineDto,
  PlanningPreviewSheetTabDto,
  PlanningWizardPanelMode,
  ProjectFlowStatus,
  ProjectLineMaterial,
  ProjectMachiningRoute,
} from '../../../core/skyflow.models';
import { planningApproveCtaKey } from '../../../core/station-presentation';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { parsePlanningComponentLabel } from './planning-component-label.util';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { httpErrorMessage } from '../../../core/http-error.util';

function previewHasUsefulContent(
  p: PlanningParsePreviewDto | null | undefined,
): boolean {
  if (!p) return false;
  if ((p.itemCount ?? 0) > 0) return true;
  return (p.sheets ?? []).some(
    (s) =>
      (s.images?.length ?? 0) > 0 ||
      (s.rows ?? []).some((r) => (r.images?.length ?? 0) > 0),
  );
}

@Component({
  selector: 'skyflow-planning-panel',
  imports: [TranslateModule, NgClass, UiButtonComponent],
  templateUrl: './planning-panel.component.html',
  styleUrl: './planning-panel.component.scss',
})
export class PlanningPanelComponent {
  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);

  private normalizePreview(p: PlanningParsePreviewDto): PlanningParsePreviewDto {
    return { ...p, sheets: p.sheets ?? [] };
  }

  /** סה״כ תמונות בגליון (משויכות לשורות + יתומות) */
  sheetImageTotal(tab: PlanningPreviewSheetTabDto): number {
    const onRows = (tab.rows ?? []).reduce(
      (a, r) => a + (r.images?.length ?? 0),
      0,
    );
    return onRows + (tab.images?.length ?? 0);
  }

  readonly projectId = input<string | null>(null);
  readonly flowStatus = input<ProjectFlowStatus | null>(null);
  /** לכותרת דוח PDF */
  readonly projectName = input<string | null>(null);
  /** מצב אשף: ברירת מחדל = מסך מלא; uploadPreview = שלב העלאה; summaryApprove = שלב אישור */
  readonly wizardMode = input<PlanningWizardPanelMode>('default');
  /** כותרת ותת־כותרת של הפאנל */
  readonly panelHeader = input(true);
  readonly lineMaterial = input<ProjectLineMaterial>('ALUMINUM');
  readonly machiningRoute = input<ProjectMachiningRoute>('GLASS');
  readonly planningSawsManagerUserId = input<string | null>(null);
  readonly sawsWorkerUserIds = input<readonly string[]>([]);

  approveCtaKey(): string {
    return planningApproveCtaKey({
      lineMaterial: this.lineMaterial(),
      machiningRoute: this.machiningRoute(),
    });
  }

  readonly planningChanged = output<void>();
  readonly planningApproved = output<void>();
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
          const empty = !previewHasUsefulContent(p);
          if (
            empty &&
            cur &&
            cur.projectId === id &&
            previewHasUsefulContent(cur)
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
      .postPlanningDraft({
        name,
        lineMaterial: 'ALUMINUM',
        machiningRoute: 'GLASS',
      })
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
    if (!pv || !previewHasUsefulContent(pv)) return;
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
        const cards = this.rowComponentCards(row);
        let cardsHtml = '';
        for (const card of cards) {
          const img = card.image
            ? `<img src="${esc(card.image.url)}" alt=""/>`
            : '';
          cardsHtml += `<article class="comp-card"><div class="comp-card__media">${img}</div><div class="comp-card__body"><p>${esc(card.label)}</p></div></article>`;
        }
        body += `<article class="row"><h3>${esc(row.displayLabel)}</h3><p><strong>${t('PLANNING.COL_INSTRUCTION')}</strong> ${esc(row.instructionKind)} · <strong>${t('PLANNING.COL_PRODUCT')}</strong> ${pt} · <strong>${t('PLANNING.COL_COMP_TOTAL')}</strong> ${row.componentCount}</p><div class="comp-grid">${cardsHtml}</div>`;
        const extras = this.rowExtraImages(row);
        if (extras?.length) {
          body += `<div class="imgs imgs--nested"><p class="img-head">${t('PLANNING.IMAGES_FOR_ROW')}</p>`;
          for (const im of extras) {
            const loc = this.translate.instant('PLANNING.IMAGE_ANCHOR', {
              row: im.anchorRow + 1,
              col: this.excelColLetter(im.anchorCol),
            });
            const cap = im.pictureName
              ? `${esc(im.pictureName)} — ${esc(loc)}`
              : esc(loc);
            body += `<figure class="imgfig"><img src="${esc(im.url)}" alt=""/><figcaption>${cap}</figcaption></figure>`;
          }
          body += `</div>`;
        }
        body += `</article>`;
      }
      if (tab.images?.length) {
        body += `<div class="imgs"><p class="img-head">${t('PLANNING.IMAGES_ORPHAN_TITLE')}</p><p class="img-hint">${t('PLANNING.IMAGES_ORPHAN_HINT')}</p>`;
        for (const im of tab.images) {
          const loc = this.translate.instant('PLANNING.IMAGE_ANCHOR', {
            row: im.anchorRow + 1,
            col: this.excelColLetter(im.anchorCol),
          });
          const cap = im.pictureName
            ? `${esc(im.pictureName)} — ${esc(loc)}`
            : esc(loc);
          body += `<figure class="imgfig"><img src="${esc(im.url)}" alt=""/><figcaption>${cap}</figcaption></figure>`;
        }
        body += `</div>`;
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
.comp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.65rem;margin-top:.5rem}
.comp-card{border:1px solid #ddd;border-radius:10px;overflow:hidden;background:#fff}
.comp-card__media{min-height:100px;background:#f1f5f9;display:flex;align-items:center;justify-content:center}
.comp-card__media img{max-width:100%;max-height:140px;object-fit:contain;display:block}
.comp-card__body{padding:.5rem .65rem;font-size:.8rem;font-weight:600;line-height:1.4}
.imgs--nested{margin-top:.5rem;padding-top:.5rem;border-top:1px dashed #ccc}
.img-head{font-size:.95rem;font-weight:700;margin:0 0 .25rem}
.img-hint{font-size:.8rem;color:#555;margin:0 0 .6rem}
.imgfig{margin:.5rem 0;border:1px solid #ddd;border-radius:10px;padding:.5rem;background:#fff}
.imgfig img{max-width:100%;height:auto;max-height:220px;display:block;margin:0 auto;object-fit:contain}
.imgfig figcaption{margin-top:.4rem;font-size:.75rem;color:#444}
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

  readonly parseComponentLabel = parsePlanningComponentLabel;

  /** כרטיסי רכיב לשורה — תומך גם בתשובת API ישנה (componentLines + images) */
  rowComponentCards(row: PlanningPreviewLineDto): PlanningPreviewComponentCardDto[] {
    if (row.componentCards?.length) {
      return row.componentCards;
    }
    const lines = row.componentLines ?? [];
    const imgs = row.images ?? [];
    return lines.map((label, i) => ({
      label,
      image: imgs[i],
    }));
  }

  /** תמונות שלא שויכו לכרטיס רכיב (רק ב-API חדש; בישן — ריק אם הכל בכרטיסים) */
  rowExtraImages(row: PlanningPreviewLineDto): PlanningPreviewLineDto['images'] {
    if (row.componentCards?.length) {
      return row.images;
    }
    const cards = this.rowComponentCards(row);
    const used = cards.filter((c) => c.image).length;
    const imgs = row.images ?? [];
    return imgs.length > used ? imgs.slice(used) : undefined;
  }

  /** תווית עמודה בגליון Excel (A…Z, AA…) — `col0` הוא 0-based כמו ב־API */
  excelColLetter(col0: number): string {
    let n = col0 + 1;
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s || 'A';
  }

  approve(): void {
    const id = this.projectId();
    if (!id) return;
    this.approving.set(true);
    this.error.set(null);
    this.api
      .postApprovePlanning(id, {
        planningSawsManagerUserId:
          this.planningSawsManagerUserId() ?? null,
        sawsWorkerUserIds: [...this.sawsWorkerUserIds()],
      })
      .pipe(
        take(1),
        finalize(() => this.approving.set(false)),
      )
      .subscribe({
        next: () => {
          this.planningApproved.emit();
          this.planningChanged.emit();
        },
        error: (err) => {
          this.error.set(httpErrorMessage(err, 'Approval failed'));
        },
      });
  }
}
