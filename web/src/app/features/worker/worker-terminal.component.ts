import { DatePipe, DecimalPipe, DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { UiButtonComponent } from '../../shared/ui-button.component';
import {
  ProjectOrder,
  SawWorkLineDto,
  WorkerContext,
  WorkerStationManagerDisplayDto,
} from '../../core/skyflow.models';
import { WorkerProjectSelectionService } from './worker-project-selection.service';
import {
  computeStationProgress,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from './station-progress';

interface SawTypeGroupVm {
  instructionKind: string;
  /** מספר מ־TYPE_n; null אם לא בפורמט TYPE_* */
  typeNum: string | null;
  lines: SawWorkLineDto[];
  totalQty: number;
}

function sawTypeOrderKey(kind: string): number {
  const m = /^TYPE_(\d+)$/i.exec(kind.trim());
  return m ? Number(m[1]) : 99999;
}

function allCheckedValidator(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const g = group as FormGroup;
    if (!g.controls) return { verify: true };
    const ok = Object.values(g.controls).every((c) => c.value === true);
    return ok ? null : { verify: true };
  };
}

@Component({
  selector: 'skyflow-worker-terminal',
  imports: [
    ReactiveFormsModule,
    TranslateModule,
    DecimalPipe,
    DatePipe,
    UiButtonComponent,
  ],
  templateUrl: './worker-terminal.component.html',
  styleUrl: './worker-terminal.component.scss',
})
export class WorkerTerminalComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);
  readonly projectSelection = inject(WorkerProjectSelectionService);

  private saveToastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly doneMsg = signal(false);
  readonly saveToastVisible = signal(false);

  readonly orders = signal<ProjectOrder[]>([]);
  readonly context = signal<WorkerContext | null>(null);

  readonly progressCircumference = PROGRESS_RING_C;

  readonly managerPhotoFailed = signal(false);
  readonly uploadingDelivery = signal(false);
  /** אינדקסים שבהם נכשלה טעינת תמונת פרופיל בצוות מסורים */
  private readonly teamPhotoFailedIdx = signal<Set<number>>(new Set());

  /** פופאפ — קבוצת סוג ניסור (TYPE_2, …) */
  readonly sawTypeModalGroup = signal<SawTypeGroupVm | null>(null);

  readonly sawTypeModalSaving = signal(false);

  /** כמויות «נוסרו» מקומיות במודאל לפי מזהה שורת מסור — עד חיבור לשרת */
  private readonly sawModalLineCounts = signal<Map<string, number>>(
    new Map(),
  );

  /** מטרים לניסור לכל שורה במודאל (±0.1 מ׳) */
  private readonly sawModalLineMeters = signal<Map<string, number>>(
    new Map(),
  );

  private static readonly SAW_MODAL_METERS_DEFAULT = 6;
  private static readonly SAW_MODAL_METERS_STEP = 0.1;
  private static readonly SAW_MODAL_METERS_MIN = 0.01;
  private static readonly SAW_MODAL_METERS_MAX = 30;

  /** תצוגת תמונה מלאה ממודאל סוגי ניסור */
  readonly sawLineImagePreviewUrl = signal<string | null>(null);

  stationId = 1;

  readonly sawMetersMin = WorkerTerminalComponent.SAW_MODAL_METERS_MIN;
  readonly sawMetersMax = WorkerTerminalComponent.SAW_MODAL_METERS_MAX;

  form!: FormGroup;

  /** תחנות 2–4: הערות / גרוטאות במודאל TYPE (בלי שדות בטופס הראשי) */
  workLineAuxForm: FormGroup | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      if (this.saveToastTimer) {
        clearTimeout(this.saveToastTimer);
        this.saveToastTimer = null;
      }
    });

    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('stationId'))),
        map((sid) => {
          if (!Number.isFinite(sid)) return 1;
          return Math.min(7, Math.max(1, sid));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((sid) => {
        this.stationId = sid;
        this.managerPhotoFailed.set(false);
        this.buildForm();
        this.tryLoadContext();
      });

    this.api
      .getOrders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.orders.set(list);
          this.projectSelection.syncFromOrders(list);
          this.tryLoadContext();
        },
        error: () =>
          this.error.set('לא ניתן לטעון הזמנות — בדוק חיבור לשרת'),
      });
  }

  onOrderChange(id: string): void {
    this.projectSelection.select(id);
    this.tryLoadContext();
  }

  stationProgress(ctx: WorkerContext): StationProgressVm {
    return computeStationProgress(this.stationId, ctx);
  }

  /** קיבוץ שורות מסורים לפי instructionKind (ללא WINDOW_INSTRUCTION) */
  sawTypeGroups(ctx: WorkerContext): SawTypeGroupVm[] {
    const lines = ctx.sawWorkLines ?? [];
    const map = new Map<string, SawWorkLineDto[]>();
    for (const line of lines) {
      const raw = (line.instructionKind ?? '').trim();
      if (raw === 'WINDOW_INSTRUCTION') continue;
      const key = raw || '_OTHER';
      const arr = map.get(key) ?? [];
      arr.push(line);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([key, ls]) => {
        const instructionKind = key === '_OTHER' ? '' : key;
        const sorted = [...ls].sort((a, b) => a.sortOrder - b.sortOrder);
        const m = /^TYPE_(\d+)$/i.exec(instructionKind);
        return {
          instructionKind,
          typeNum: m ? m[1] : null,
          lines: sorted,
          totalQty: sorted.reduce((s, l) => s + l.quantity, 0),
        };
      })
      .sort((a, b) => {
        const da = sawTypeOrderKey(a.instructionKind);
        const db = sawTypeOrderKey(b.instructionKind);
        if (da !== db) return da - db;
        return a.instructionKind.localeCompare(b.instructionKind);
      });
  }

  openSawTypeModal(g: SawTypeGroupVm): void {
    const ctx = this.context();
    const fromApi =
      this.stationId === 1
        ? ctx?.sawWorkSawnByLineId
        : ctx?.workLineDoneByLineId;
    const next = new Map<string, number>();
    if (fromApi) {
      for (const line of g.lines) {
        const v = fromApi[line.id];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          next.set(line.id, Math.floor(v));
        }
      }
    }
    this.sawModalLineCounts.set(next);

    if (this.stationId === 1) {
      const fromM = ctx?.sawWorkMetersByLineId;
      const mNext = new Map<string, number>();
      for (const line of g.lines) {
        const raw = fromM?.[line.id];
        const m =
          typeof raw === 'number' &&
          Number.isFinite(raw) &&
          raw >= WorkerTerminalComponent.SAW_MODAL_METERS_MIN
            ? Math.round(raw * 100) / 100
            : WorkerTerminalComponent.SAW_MODAL_METERS_DEFAULT;
        mNext.set(
          line.id,
          Math.min(
            WorkerTerminalComponent.SAW_MODAL_METERS_MAX,
            Math.max(WorkerTerminalComponent.SAW_MODAL_METERS_MIN, m),
          ),
        );
      }
      this.sawModalLineMeters.set(mNext);
    } else {
      this.sawModalLineMeters.set(new Map());
    }

    this.sawTypeModalGroup.set(g);
  }

  closeSawTypeModal(): void {
    this.sawLineImagePreviewUrl.set(null);
    this.sawTypeModalGroup.set(null);
  }

  openSawLineImagePreview(url: string): void {
    const u = url.trim();
    if (u.length) this.sawLineImagePreviewUrl.set(u);
  }

  closeSawLineImagePreview(): void {
    this.sawLineImagePreviewUrl.set(null);
  }

  /** תמונה ראשונה לשורת מסור (אם קיימת) */
  firstSawLineImage(line: SawWorkLineDto): string | null {
    const u = line.imagePaths?.[0]?.trim();
    return u?.length ? u : null;
  }

  /** כותרת קצרה לכרטיס — אחרי `] ` בתיאור (למשל MPB-X (mm)) */
  sawLineShortTitle(line: SawWorkLineDto): string {
    const d = line.description.trim();
    const cut = d.lastIndexOf('] ');
    const tail = cut >= 0 ? d.slice(cut + 2).trim() : d;
    return tail.length ? tail : line.componentKind;
  }

  modalLineSawnQty(lineId: string): number {
    return this.sawModalLineCounts().get(lineId) ?? 0;
  }

  nudgeModalLineSawn(lineId: string, maxQty: number, delta: number): void {
    this.sawModalLineCounts.update((m) => {
      const next = new Map(m);
      const cur = next.get(lineId) ?? 0;
      const n = Math.max(0, Math.min(maxQty, cur + delta));
      next.set(lineId, n);
      return next;
    });
  }

  modalLineMeters(lineId: string): number {
    return (
      this.sawModalLineMeters().get(lineId) ??
      WorkerTerminalComponent.SAW_MODAL_METERS_DEFAULT
    );
  }

  nudgeModalLineMeters(lineId: string, delta: number): void {
    const step = WorkerTerminalComponent.SAW_MODAL_METERS_STEP;
    const d = Math.sign(delta) * step;
    this.sawModalLineMeters.update((m) => {
      const next = new Map(m);
      const cur =
        next.get(lineId) ?? WorkerTerminalComponent.SAW_MODAL_METERS_DEFAULT;
      const n =
        Math.round(
          Math.min(
            WorkerTerminalComponent.SAW_MODAL_METERS_MAX,
            Math.max(
              WorkerTerminalComponent.SAW_MODAL_METERS_MIN,
              cur + d,
            ),
          ) * 100,
        ) / 100;
      next.set(lineId, n);
      return next;
    });
  }

  /** פחת (ס״מ) לשורה: צורך לפי כמות×אורך פרופיל מינוס נוסרו×מטרים×100 */
  modalLineRemnantCm(line: SawWorkLineDto): number {
    const ctx = this.context();
    if (!ctx || this.stationId !== 1) return 0;
    const orig = Number(ctx.order.originalLength);
    if (!Number.isFinite(orig) || orig <= 0) return 0;
    const sawn = this.modalLineSawnQty(line.id);
    const meters = this.modalLineMeters(line.id);
    const cl = meters * 100;
    if (!Number.isFinite(cl) || cl <= 0) return 0;
    return Math.max(0, line.quantity * orig - sawn * cl);
  }
  sawLineUnitLabel(line: SawWorkLineDto): string | null {
    const d = line.description.trim();
    const m = /^\[\[[^\]]*\]\s*([^\]]+)\]/.exec(d);
    const v = m?.[1]?.trim();
    return v?.length ? v : null;
  }

  /** שורת שם בולטת בכרטיס — יחידה מהתיאור, אחרת סוג רכיב, אחרת כותרת קצרה */
  sawLineNameRow(line: SawWorkLineDto): string {
    return (
      this.sawLineUnitLabel(line) ??
      line.componentKind?.trim() ??
      this.sawLineShortTitle(line)
    );
  }

  /** תיאור לתצוגה — בלי קידומת `[[TYPE n]` */
  sawLineDescriptionDisplay(line: SawWorkLineDto): string {
    const d = line.description.trim();
    return d.replace(/^\[\[TYPE_?\s*\d+\]\s*/i, '').trim();
  }

  async saveSawTypeModal(): Promise<void> {
    const mg = this.sawTypeModalGroup();
    const pid = this.projectSelection.selectedProjectId();
    const sid = this.stationId;
    if (!mg || !pid || this.sawTypeModalSaving()) {
      return;
    }
    if (sid !== 1 && (sid < 2 || sid > 4)) {
      return;
    }

    if (sid === 1) {
      const sawLineSawnById: Record<string, number> = {};
      const sawLineMetersById: Record<string, number> = {};
      let sumMeters = 0;
      for (const line of mg.lines) {
        sawLineSawnById[line.id] = this.modalLineSawnQty(line.id);
        const m = this.modalLineMeters(line.id);
        sawLineMetersById[line.id] = m;
        sumMeters += m;
      }
      const avgMeters =
        mg.lines.length > 0 ? sumMeters / mg.lines.length : 6;
      const cutLength = Math.round(
        Math.max(0.01, avgMeters) * 100,
      );

      this.sawTypeModalSaving.set(true);
      this.error.set(null);
      try {
        await firstValueFrom(
          this.api.postStationLog(1, {
            projectId: pid,
            processedQty: 0,
            cutLength,
            extraPayload: {
              sawModalSnapshot: true,
              instructionKind: mg.instructionKind || 'OTHER',
              sawLineSawnById,
              sawLineMetersById,
            },
          }),
        );
        this.closeSawTypeModal();
        this.tryLoadContext();
        this.showSaveToast();
      } catch {
        this.error.set('שמירת ניסור לפי סוג נכשלה — נסה שוב');
      } finally {
        this.sawTypeModalSaving.set(false);
      }
      return;
    }

    const lineQtyById: Record<string, number> = {};
    for (const line of mg.lines) {
      lineQtyById[line.id] = this.modalLineSawnQty(line.id);
    }
    const issuesRaw = this.workLineAuxForm?.get('issues')?.value;
    const issues =
      typeof issuesRaw === 'string' && issuesRaw.trim().length
        ? issuesRaw.trim()
        : undefined;
    const scrapQty = Number(this.workLineAuxForm?.get('scrapQty')?.value ?? 0);
    const scrapLen = Number(
      this.workLineAuxForm?.get('scrapLength')?.value ?? 0,
    );

    this.sawTypeModalSaving.set(true);
    this.error.set(null);
    try {
      if ([3, 4].includes(sid) && scrapQty > 0 && scrapLen > 0) {
        await firstValueFrom(
          this.api.postScrap(sid, {
            projectId: pid,
            scrapQty,
            itemLength: scrapLen,
          }),
        );
      }
      await firstValueFrom(
        this.api.postStationLog(sid, {
          projectId: pid,
          processedQty: 0,
          issues,
          extraPayload: {
            workLineModalSnapshot: true,
            instructionKind: mg.instructionKind || 'OTHER',
            lineQtyById,
          },
        }),
      );
      this.closeSawTypeModal();
      this.tryLoadContext();
      this.showSaveToast();
    } catch {
      this.error.set('שמירה נכשלה — נסה שוב');
    } finally {
      this.sawTypeModalSaving.set(false);
    }
  }

  /**
   * כותרת סוג ניסור סטטית (כמו בתכנון): TYPE 2, TYPE 4, … — לא דרך i18n.
   */
  sawInstructionKindTitle(
    instructionKind: string,
    typeNum: string | null,
  ): string {
    if (typeNum !== null) return `TYPE ${typeNum}`;
    const k = (instructionKind ?? '').trim();
    if (!k) return 'OTHER';
    const m = /^TYPE_(\d+)$/i.exec(k);
    if (m) return `TYPE ${m[1]}`;
    return k.replace(/_/g, ' ');
  }

  /** כמות שנוסרה לפי סוג (מתוך sawWorkSawnByKind — יתמלא כשיימש דיווח לפי TYPE) */
  sawnQtyForSawTypeGroup(ctx: WorkerContext, g: SawTypeGroupVm): number {
    const m = ctx.sawWorkSawnByKind;
    if (!m) return 0;
    const k = g.instructionKind ?? '';
    const v = m[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
  }

  /** תחנות 2–4: סכום כמויות שדווחו לשורות בקבוצת TYPE */
  lineDoneQtyForTypeGroup(ctx: WorkerContext, g: SawTypeGroupVm): number {
    const m = ctx.workLineDoneByLineId;
    if (!m) return 0;
    let s = 0;
    for (const line of g.lines) {
      const v = m[line.id];
      if (typeof v === 'number' && Number.isFinite(v)) {
        s += Math.max(0, Math.floor(v));
      }
    }
    return s;
  }

  /** כרטיס TYPE — התקדמות לפי תחנה */
  typeGroupDoneQty(ctx: WorkerContext, g: SawTypeGroupVm): number {
    return this.stationId === 1
      ? this.sawnQtyForSawTypeGroup(ctx, g)
      : this.lineDoneQtyForTypeGroup(ctx, g);
  }

  /** תחנות 2–4 עם שורות תכנון — UI מודאל TYPE בלי טופס ראשי */
  usesWorkLineModalUi(ctx: WorkerContext): boolean {
    return (
      this.stationId >= 2 &&
      this.stationId <= 4 &&
      (ctx.sawWorkLines?.length ?? 0) > 0
    );
  }

  managerAvatarSrc(): string {
    const ctx = this.context();
    const u = ctx?.stationManagerDisplay?.photoUrl?.trim();
    if (u?.length) return u;
    return `/assets/managers/${this.stationId}.jpg`;
  }

  onManagerPhotoError(): void {
    this.managerPhotoFailed.set(true);
  }

  teamPhotoFailed(index: number): boolean {
    return this.teamPhotoFailedIdx().has(index);
  }

  onTeamPhotoError(index: number): void {
    this.teamPhotoFailedIdx.update((s) => new Set(s).add(index));
  }

  teamMemberInitials(m: WorkerStationManagerDisplayDto): string {
    const f = (m.firstName ?? '').trim();
    const l = (m.lastName ?? '').trim();
    return ((f.charAt(0) || '?') + (l.charAt(0) || '')).toUpperCase();
  }

  progressDashOffset(percent: number): number {
    return ringStrokeDashOffset(percent);
  }

  async onDeliveryFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const pid = this.projectSelection.selectedProjectId();
    if (!file || !pid || this.stationId !== 7) return;
    this.uploadingDelivery.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.postSiteDeliveryNote(pid, file));
      this.tryLoadContext();
      this.showSaveToast();
    } catch {
      this.error.set('העלאת תעודת משלוח נכשלה');
    } finally {
      this.uploadingDelivery.set(false);
      input.value = '';
    }
  }

  private scrollToProgress(): void {
    const prefersReduced =
      typeof this.doc.defaultView?.matchMedia === 'function' &&
      this.doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)')
        .matches;
    queueMicrotask(() => {
      this.doc
        .getElementById('station-progress-panel')
        ?.scrollIntoView({
          behavior: prefersReduced ? 'auto' : 'smooth',
          block: 'start',
        });
    });
  }

  private showSaveToast(): void {
    if (this.saveToastTimer) {
      clearTimeout(this.saveToastTimer);
      this.saveToastTimer = null;
    }
    this.saveToastVisible.set(true);
    this.saveToastTimer = setTimeout(() => {
      this.saveToastVisible.set(false);
      this.saveToastTimer = null;
    }, 4200);
  }

  scrapCm(): number {
    const ctx = this.context();
    if (!ctx || this.stationId !== 1 || !this.form) return 0;
    const target =
      ctx.sawWorkTargetQty != null && ctx.sawWorkTargetQty > 0
        ? ctx.sawWorkTargetQty
        : ctx.order.totalItems;
    const orig = Number(ctx.order.originalLength);
    const pq = Number(this.form.get('barsQty')?.value ?? 0);
    const meters = Number(this.form.get('metersPerBar')?.value ?? 0);
    const cl = meters * 100;
    if (!target || !orig || !cl) return 0;
    return Math.max(0, target * orig - pq * cl);
  }

  private tryLoadContext(): void {
    const pid = this.projectSelection.selectedProjectId();
    if (
      !pid ||
      !this.stationId ||
      this.stationId < 1 ||
      this.stationId > 7
    ) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.doneMsg.set(false);
    this.api
      .getWorkerContext(this.stationId, pid)
      .subscribe({
        next: (ctx) => {
          this.context.set({
            ...ctx,
            activityLog: ctx.activityLog ?? [],
            sawWorkSawnByKind: ctx.sawWorkSawnByKind ?? {},
            sawWorkSawnByLineId: ctx.sawWorkSawnByLineId ?? {},
            sawWorkMetersByLineId: ctx.sawWorkMetersByLineId ?? {},
            workLineDoneByLineId: ctx.workLineDoneByLineId ?? {},
          });
          this.managerPhotoFailed.set(false);
          this.teamPhotoFailedIdx.set(new Set());
          this.closeSawTypeModal();
          this.loading.set(false);
          if (
            this.stationId === 6 &&
            ctx.packedQty >= ctx.requiredPackQty
          ) {
            this.doneMsg.set(true);
          }
          if (this.stationId === 7) {
            const pct = this.stationProgress(ctx).percent;
            this.doneMsg.set(pct >= 100);
            const sa = ctx.siteAssembly;
            if (sa && this.form?.get('assembledBeams')) {
              this.form.patchValue({
                assembledBeams: sa.assembledBeams,
                assembledGlazing: sa.assembledGlazing,
                assembledUnitized: sa.assembledUnitized,
              });
            }
          }
        },
        error: () => {
          this.loading.set(false);
          this.error.set('שגיאה בטעינת העמדה — נסה שוב');
        },
      });
  }

  private buildForm(): void {
    const sid = this.stationId;
    this.workLineAuxForm = null;

    if (sid === 5) {
      const checks = this.fb.group(
        {
          s1: new FormControl(false, { nonNullable: true }),
          s2: new FormControl(false, { nonNullable: true }),
          s3: new FormControl(false, { nonNullable: true }),
          s4: new FormControl(false, { nonNullable: true }),
        },
        { validators: allCheckedValidator() },
      );
      this.form = this.fb.group({
        checks,
      });
      return;
    }

    const base = {
      issues: [''],
    };

    switch (sid) {
      case 1:
        this.form = this.fb.group({});
        break;
      case 2:
        this.workLineAuxForm = this.fb.group({
          issues: [''],
        });
        this.form = this.fb.group({
          ...base,
          processedQty: [0, [Validators.required, Validators.min(0)]],
        });
        break;
      case 3:
        this.workLineAuxForm = this.fb.group({
          issues: [''],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        this.form = this.fb.group({
          ...base,
          usedQty: [0, [Validators.required, Validators.min(0)]],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        break;
      case 4:
        this.workLineAuxForm = this.fb.group({
          issues: [''],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        this.form = this.fb.group({
          ...base,
          gluedQty: [0, [Validators.required, Validators.min(0)]],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        break;
      case 6:
        this.form = this.fb.group({
          ...base,
          packedQty: [0, [Validators.required, Validators.min(0)]],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        break;
      case 7:
        this.form = this.fb.group({
          ...base,
          assembledBeams: [
            0,
            [Validators.required, Validators.min(0)],
          ],
          assembledGlazing: [
            0,
            [Validators.required, Validators.min(0)],
          ],
          assembledUnitized: [
            0,
            [Validators.required, Validators.min(0)],
          ],
        });
        break;
      default:
        this.form = this.fb.group({ ...base });
    }
  }

  async submit(): Promise<void> {
    const pid = this.projectSelection.selectedProjectId();
    const ctx = this.context();
    if (
      this.stationId >= 2 &&
      this.stationId <= 4 &&
      ctx &&
      this.usesWorkLineModalUi(ctx)
    ) {
      return;
    }
    if (!this.form || !pid || this.form.invalid) {
      this.form?.markAllAsTouched();
      return;
    }
    if (this.stationId === 1) {
      return;
    }

    const raw = this.form.getRawValue();
    const sid = this.stationId;
    this.saving.set(true);
    this.error.set(null);

    let processedQty = 0;
    let extraPayload: Record<string, unknown> | undefined;

    if (sid === 1) {
      processedQty = Number(raw['barsQty']);
    } else if (sid === 2) {
      processedQty = Number(raw['processedQty']);
    } else if (sid === 3) {
      processedQty = Number(raw['usedQty']);
    } else if (sid === 4) {
      processedQty = Number(raw['gluedQty']);
    } else if (sid === 5) {
      processedQty = 1;
      extraPayload = { finishingChecks: raw['checks'] };
    } else if (sid === 6) {
      processedQty = Number(raw['packedQty']);
    } else if (sid === 7) {
      processedQty = 1;
      extraPayload = {
        assembledBeams: Number(raw['assembledBeams']),
        assembledGlazing: Number(raw['assembledGlazing']),
        assembledUnitized: Number(raw['assembledUnitized']),
      };
    }

    const logBody: Record<string, unknown> = {
      projectId: pid,
      processedQty,
      issues: raw['issues'] || undefined,
    };

    if (sid === 1) {
      const meters = Number(raw['metersPerBar']);
      logBody['cutLength'] = Math.round(meters * 100);
    }
    if (extraPayload) {
      logBody['extraPayload'] = extraPayload;
    }

    const scrapQty = Number(raw['scrapQty'] ?? 0);
    const scrapLen = Number(raw['scrapLength'] ?? 0);

    try {
      if (sid === 1) {
        const auto = this.scrapCm();
        if (auto > 0) {
          await firstValueFrom(
            this.api.postScrap(1, {
              projectId: pid,
              scrapQty: 1,
              itemLength: auto,
            }),
          );
        }
      }

      if ([3, 4, 6].includes(sid) && scrapQty > 0 && scrapLen > 0) {
        await firstValueFrom(
          this.api.postScrap(sid, {
            projectId: pid,
            scrapQty,
            itemLength: scrapLen,
          }),
        );
      }

      await firstValueFrom(this.api.postStationLog(sid, logBody));

      const ctx = await firstValueFrom(
        this.api.getWorkerContext(sid, pid),
      );
      this.context.set({
        ...ctx,
        activityLog: ctx.activityLog ?? [],
        sawWorkSawnByKind: ctx.sawWorkSawnByKind ?? {},
        sawWorkSawnByLineId: ctx.sawWorkSawnByLineId ?? {},
        sawWorkMetersByLineId: ctx.sawWorkMetersByLineId ?? {},
        workLineDoneByLineId: ctx.workLineDoneByLineId ?? {},
      });
      if (sid === 6 && ctx.packedQty >= ctx.requiredPackQty) {
        this.doneMsg.set(true);
      }
      if (sid === 7 && this.stationProgress(ctx).percent >= 100) {
        this.doneMsg.set(true);
      }
      this.scrollToProgress();
      this.showSaveToast();
    } catch {
      this.error.set('שמירה נכשלה');
    } finally {
      this.saving.set(false);
    }
  }
}
