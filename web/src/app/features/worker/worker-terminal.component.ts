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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { UiButtonComponent } from '../../shared/ui-button.component';
import {
  ProjectOrder,
  SawWorkLineDto,
  SummaryStationRow,
  WorkerActivityLogEntryDto,
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
import { packPhotoRequiredCount, MAX_PACK_PHOTO_SLOTS } from './pack-photo.util';

interface SawTypeGroupVm {
  instructionKind: string;
  /** מספר מ־TYPE_n; null אם לא בפורמט TYPE_* */
  typeNum: string | null;
  lines: SawWorkLineDto[];
  totalQty: number;
}

type FinishingCheckKey = 's1' | 's2' | 's3' | 's4';

interface FinishingCheckStep {
  key: FinishingCheckKey;
  stationId: number;
  accent: string;
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
    RouterLink,
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
  readonly uploadingPackSlot = signal<number | null>(null);
  /** משבצות תמונה נוספות מעבר לנדרש (עמדה 6) */
  readonly packExtraSlots = signal(0);
  /** אינדקסים שבהם נכשלה טעינת תמונת פרופיל בצוות מסורים */
  private readonly teamPhotoFailedIdx = signal<Set<number>>(new Set());

  /** פופאפ — קבוצת סוג ניסור (TYPE_2, …) */
  readonly sawTypeModalGroup = signal<SawTypeGroupVm | null>(null);

  readonly sawTypeModalSaving = signal(false);

  /** מודאל אימות שלב — תחנה 5 (פינישים) */
  readonly finishingVerifyKey = signal<FinishingCheckKey | null>(null);

  /** יומן דיווחים — תחנות פתוחות באקורדיון */
  private readonly activityLogExpanded = signal<Set<number>>(new Set());

  private static readonly ACTIVITY_LOG_STATION_IDS = [1, 2, 3, 4, 5, 6, 7] as const;

  readonly finishingCheckSteps: FinishingCheckStep[] = [
    { key: 's1', stationId: 1, accent: '#fbbf24' },
    { key: 's2', stationId: 2, accent: '#22d3ee' },
    { key: 's3', stationId: 3, accent: '#34d399' },
    { key: 's4', stationId: 4, accent: '#d8b4fe' },
  ];

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

  nextStationId(): number | null {
    return this.stationId >= 1 && this.stationId < 7 ? this.stationId + 1 : null;
  }

  canMoveToNextStation(ctx: WorkerContext): boolean {
    if (this.nextStationId() === null) return false;
    if (this.stationId === 6) {
      return ctx.packReport?.complete === true;
    }
    return this.stationProgress(ctx).percent >= 100;
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

    if (this.stationId === 1 && ctx) {
      const mNext = new Map<string, number>();
      for (const line of g.lines) {
        mNext.set(line.id, this.effectiveSawMetersForLine(ctx, line));
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

  fillModalLineSawn(lineId: string, maxQty: number): void {
    if (maxQty <= 0) return;
    this.sawModalLineCounts.update((m) => {
      const next = new Map(m);
      next.set(lineId, maxQty);
      return next;
    });
  }

  modalLineMeters(lineId: string): number {
    return (
      this.sawModalLineMeters().get(lineId) ??
      WorkerTerminalComponent.SAW_MODAL_METERS_DEFAULT
    );
  }

  /**
   * מטרים לניסור לשורה: דיווח אחרון מהמודאל (תחנה 1), אחרת אורך מהתכנון (ס״מ→מ׳),
   * אחרת ברירת מחדל.
   */
  effectiveSawMetersForLine(ctx: WorkerContext, line: SawWorkLineDto): number {
    const rawM = ctx.sawWorkMetersByLineId?.[line.id];
    if (
      typeof rawM === 'number' &&
      Number.isFinite(rawM) &&
      rawM >= WorkerTerminalComponent.SAW_MODAL_METERS_MIN
    ) {
      return Math.min(
        WorkerTerminalComponent.SAW_MODAL_METERS_MAX,
        Math.max(
          WorkerTerminalComponent.SAW_MODAL_METERS_MIN,
          Math.round(rawM * 100) / 100,
        ),
      );
    }
    const cm = line.planningCutLengthCm;
    if (typeof cm === 'number' && Number.isFinite(cm) && cm > 0) {
      const m = Math.round((cm / 100) * 100) / 100;
      return Math.min(
        WorkerTerminalComponent.SAW_MODAL_METERS_MAX,
        Math.max(WorkerTerminalComponent.SAW_MODAL_METERS_MIN, m),
      );
    }
    return WorkerTerminalComponent.SAW_MODAL_METERS_DEFAULT;
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

  /**
   * אורך צורך (ס״מ) לקורה בשורת מסור: מתכנון (תא פרופיל) כשקיים,
   * אחרת `originalLength` מהפרויקט — כדי שלא יערבבו אורך יחידה כללי עם מטרים לשורה.
   */
  private sawBarNeedLengthCm(
    line: SawWorkLineDto,
    orderOriginalCm: number,
  ): number {
    const p = line.planningCutLengthCm;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return p;
    }
    if (Number.isFinite(orderOriginalCm) && orderOriginalCm > 0) {
      return orderOriginalCm;
    }
    return 0;
  }

  /** פחת (ס״מ) לשורה: צורך לפי כמות×אורך פרופיל (מתכנון או BOM) מינוס נוסרו×מטרים×100 */
  modalLineRemnantCm(line: SawWorkLineDto): number {
    const ctx = this.context();
    if (!ctx || this.stationId !== 1) return 0;
    const orig = Number(ctx.order.originalLength);
    const perBarNeed = this.sawBarNeedLengthCm(line, orig);
    if (!Number.isFinite(perBarNeed) || perBarNeed <= 0) return 0;
    const sawn = this.modalLineSawnQty(line.id);
    const meters = this.modalLineMeters(line.id);
    const cl = meters * 100;
    if (!Number.isFinite(cl) || cl <= 0) return 0;
    return Math.max(0, line.quantity * perBarNeed - sawn * cl);
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

    this.sawTypeModalSaving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.api.postStationLog(sid, {
          projectId: pid,
          processedQty: 0,
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

  /** אחוז התקדמות בתוך קבוצת TYPE (טבעת באריח) */
  typeGroupProgressPercent(ctx: WorkerContext, g: SawTypeGroupVm): number {
    const t = g.totalQty;
    if (!Number.isFinite(t) || t <= 0) return 0;
    const d = this.typeGroupDoneQty(ctx, g);
    return Math.min(100, Math.round((d / t) * 100));
  }

  typeGroupIsComplete(ctx: WorkerContext, g: SawTypeGroupVm): boolean {
    return this.typeGroupProgressPercent(ctx, g) >= 100;
  }

  /** פחת (ס״מ) לשורה לפי דיווחי מסור ב־context — כמו המודאל, בלי מפת המודאל */
  lineRemnantCmAtSawFromContext(
    ctx: WorkerContext,
    line: SawWorkLineDto,
  ): number {
    const orig = Number(ctx.order.originalLength);
    const perBarNeed = this.sawBarNeedLengthCm(line, orig);
    if (!Number.isFinite(perBarNeed) || perBarNeed <= 0) return 0;
    const rawS = ctx.sawWorkSawnByLineId?.[line.id];
    const sawn =
      typeof rawS === 'number' && Number.isFinite(rawS)
        ? Math.max(0, Math.floor(rawS))
        : 0;
    const meters = this.effectiveSawMetersForLine(ctx, line);
    const cl = meters * 100;
    if (!Number.isFinite(cl) || cl <= 0) return 0;
    return Math.max(0, line.quantity * perBarNeed - sawn * cl);
  }

  /** סה״כ פחת משוער (ס״מ) לכל שורות קבוצת TYPE — מצטבר ממסורים */
  typeGroupRemnantCm(ctx: WorkerContext, g: SawTypeGroupVm): number {
    return g.lines.reduce(
      (s, line) => s + this.lineRemnantCmAtSawFromContext(ctx, line),
      0,
    );
  }

  typeGroupShowsRemnant(ctx: WorkerContext, g: SawTypeGroupVm): boolean {
    return this.typeGroupRemnantCm(ctx, g) > 0;
  }

  /** תחנות 2–4 עם שורות תכנון — UI מודאל TYPE בלי טופס ראשי */
  usesWorkLineModalUi(ctx: WorkerContext): boolean {
    return (
      this.stationId >= 2 &&
      this.stationId <= 4 &&
      (ctx.sawWorkLines?.length ?? 0) > 0
    );
  }

  finishingCheckStep(key: FinishingCheckKey): FinishingCheckStep {
    return this.finishingCheckSteps.find((s) => s.key === key)!;
  }

  isFinishingCheckDone(key: FinishingCheckKey): boolean {
    return this.form?.get('checks')?.get(key)?.value === true;
  }

  finishingChecksDoneCount(): number {
    const checks = this.form?.get('checks');
    if (!checks) return 0;
    return this.finishingCheckSteps.filter(
      (s) => checks.get(s.key)?.value === true,
    ).length;
  }

  finishingChecksPercent(): number {
    return (this.finishingChecksDoneCount() / this.finishingCheckSteps.length) * 100;
  }

  summaryRowForStation(
    ctx: WorkerContext,
    stationId: number,
  ): SummaryStationRow | undefined {
    return ctx.summaryStations?.find((r) => r.stationId === stationId);
  }

  activityLogForStation(
    ctx: WorkerContext,
    stationId: number,
  ): WorkerActivityLogEntryDto[] {
    return (ctx.activityLog ?? []).filter((e) => e.stationId === stationId);
  }

  /** האם להציג עמודת מטריקות בכרטיס התחנה */
  stationBriefHasStats(): boolean {
    if (this.stationId >= 2 && this.stationId <= 4) return true;
    if (this.stationId === 1) return true;
    if (this.stationId === 6) return true;
    if (this.stationId === 7) return true;
    return false;
  }

  activityLogStationIds(ctx: WorkerContext): number[] {
    const ids = new Set((ctx.activityLog ?? []).map((e) => e.stationId));
    return WorkerTerminalComponent.ACTIVITY_LOG_STATION_IDS.filter((id) =>
      ids.has(id),
    );
  }

  isActivityLogExpanded(stationId: number): boolean {
    return this.activityLogExpanded().has(stationId);
  }

  toggleActivityLogStation(stationId: number): void {
    const next = new Set(this.activityLogExpanded());
    if (next.has(stationId)) {
      next.delete(stationId);
    } else {
      next.add(stationId);
    }
    this.activityLogExpanded.set(next);
  }

  openFinishingVerify(key: FinishingCheckKey): void {
    if (this.stationId !== 5 || !this.form?.get('checks')) return;
    this.finishingVerifyKey.set(key);
  }

  closeFinishingVerify(): void {
    this.finishingVerifyKey.set(null);
  }

  confirmFinishingVerify(key: FinishingCheckKey): void {
    const ctrl = this.form?.get('checks')?.get(key);
    if (!ctrl) return;
    ctrl.setValue(true);
    ctrl.markAsTouched();
    this.closeFinishingVerify();
  }

  packPhotoSlotIndexes(ctx: WorkerContext): number[] {
    const n = this.packPhotoVisibleCount(ctx);
    return Array.from({ length: n }, (_, i) => i);
  }

  packPhotoVisibleCount(ctx: WorkerContext): number {
    return this.packReportRequiredCount(ctx) + this.packExtraSlots();
  }

  canAddPackPhotoSlot(ctx: WorkerContext): boolean {
    return this.packPhotoVisibleCount(ctx) < MAX_PACK_PHOTO_SLOTS;
  }

  addPackPhotoSlot(): void {
    const ctx = this.context();
    if (!ctx || !this.canAddPackPhotoSlot(ctx)) return;
    this.packExtraSlots.update((n) => n + 1);
  }

  isPackPhotoSlotOptional(ctx: WorkerContext, slotIndex: number): boolean {
    return slotIndex >= this.packReportRequiredCount(ctx);
  }

  private syncPackExtraSlots(ctx: WorkerContext): void {
    const required = this.packReportRequiredCount(ctx);
    const photos = ctx.packReport?.photos ?? [];
    const maxSlot = photos.reduce(
      (max, photo) => Math.max(max, photo.slotIndex),
      -1,
    );
    const minVisible = Math.max(required, maxSlot + 1);
    this.packExtraSlots.set(Math.max(0, minVisible - required));
  }

  packReportRequiredCount(ctx: WorkerContext): number {
    return (
      ctx.packReport?.requiredCount ??
      packPhotoRequiredCount(ctx.order.totalItems)
    );
  }

  packReportComplete(ctx: WorkerContext): boolean {
    if (ctx.packReport?.complete) return true;
    const required = this.packReportRequiredCount(ctx);
    return (
      required > 0 && this.packPhotosUploadedCount(ctx) >= required
    );
  }

  packPhotoUrl(ctx: WorkerContext, slotIndex: number): string | null {
    return (
      ctx.packReport?.photos.find((p) => p.slotIndex === slotIndex)?.url ??
      null
    );
  }

  packPhotosUploadedCount(ctx: WorkerContext): number {
    const required = this.packReportRequiredCount(ctx);
    const photos = ctx.packReport?.photos ?? [];
    let filled = 0;
    for (let i = 0; i < required; i++) {
      if (photos.some((p) => p.slotIndex === i)) filled++;
    }
    return filled;
  }

  packPhotosProgressPercent(ctx: WorkerContext): number {
    const required = this.packReportRequiredCount(ctx);
    if (required <= 0) return 0;
    return Math.min(
      100,
      Math.round((this.packPhotosUploadedCount(ctx) / required) * 100),
    );
  }

  isPackPhotoSlotUploading(slotIndex: number): boolean {
    return this.uploadingPackSlot() === slotIndex;
  }

  triggerPackPhotoInput(slotIndex: number): void {
    this.doc.getElementById(`pack-photo-input-${slotIndex}`)?.click();
  }

  async onPackPhotoSelected(ev: Event, slotIndex: number): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const pid = this.projectSelection.selectedProjectId();
    if (!file || !pid || this.stationId !== 6) return;
    this.uploadingPackSlot.set(slotIndex);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.api.postPackPhoto(pid, slotIndex, file),
      );
      const ctx = await firstValueFrom(
        this.api.getWorkerContext(6, pid),
      );
      this.context.set({
        ...ctx,
        activityLog: ctx.activityLog ?? [],
        sawWorkSawnByKind: ctx.sawWorkSawnByKind ?? {},
        sawWorkSawnByLineId: ctx.sawWorkSawnByLineId ?? {},
        sawWorkMetersByLineId: ctx.sawWorkMetersByLineId ?? {},
        workLineDoneByLineId: ctx.workLineDoneByLineId ?? {},
      });
      this.syncPackExtraSlots(ctx);
      if (res.complete) {
        this.doneMsg.set(true);
        this.showSaveToast();
        this.scrollToProgress();
      }
    } catch {
      this.error.set('העלאת תמונת אריזה נכשלה — נסה שוב');
    } finally {
      this.uploadingPackSlot.set(null);
      input.value = '';
    }
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
    this.activityLogExpanded.set(new Set());
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
          if (this.stationId === 6) {
            this.syncPackExtraSlots(ctx);
          }
          if (this.stationId === 6 && ctx.packReport?.complete) {
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

    switch (sid) {
      case 1:
        this.form = this.fb.group({});
        break;
      case 2:
        this.form = this.fb.group({
          processedQty: [0, [Validators.required, Validators.min(0)]],
        });
        break;
      case 3:
        this.form = this.fb.group({
          usedQty: [0, [Validators.required, Validators.min(0)]],
        });
        break;
      case 4:
        this.form = this.fb.group({
          gluedQty: [0, [Validators.required, Validators.min(0)]],
        });
        break;
      case 6:
        this.form = this.fb.group({});
        break;
      case 7:
        this.form = this.fb.group({
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
        this.form = this.fb.group({});
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
    };

    if (sid === 1) {
      const meters = Number(raw['metersPerBar']);
      logBody['cutLength'] = Math.round(meters * 100);
    }
    if (extraPayload) {
      logBody['extraPayload'] = extraPayload;
    }

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
