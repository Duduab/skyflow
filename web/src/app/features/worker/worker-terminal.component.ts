import { DatePipe, DecimalPipe, DOCUMENT, NgStyle } from '@angular/common';
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
import { UiPopupComponent } from '../../shared/ui-popup/ui-popup.component';
import { StationCompleteToastComponent } from '../../shared/station-complete-toast/station-complete-toast.component';
import {
  AssemblyPipelineLineDto,
  AssemblyStationContextDto,
  AssemblyWindowUnitDto,
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
  hasAnySawStationReport,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from './station-progress';
import { packPhotoRequiredCount, MAX_PACK_PHOTO_SLOTS } from './pack-photo.util';
import {
  CATALOG_PROFILE_CODES,
  normalizeProfileCode,
  profileKindFromCode,
} from '../../core/profile-inventory.util';
import { httpErrorMessage } from '../../core/http-error.util';
import { StationLabelPipe } from '../../shared/station-label.pipe';
import {
  stationLabelKey,
  stationVisualModifierClass,
  stationVisualStyle,
} from '../../core/station-presentation';

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
    StationCompleteToastComponent,
    UiPopupComponent,
    NgStyle,
    StationLabelPipe,
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
  private stationCompleteToastTimer: ReturnType<typeof setTimeout> | null = null;
  private sawSaveCelebrationTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SAW_SAVE_CELEBRATION_MS = 3000;
  /** מעקב להצגת toast רק במעבר ל־100% (לא בטעינה ראשונית) */
  private stationWasComplete = false;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly doneMsg = signal(false);
  readonly saveToastVisible = signal(false);
  readonly stationCompleteToastVisible = signal(false);

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

  /** תחנה 3 — סינון TYPE בקו ייצור */
  readonly assemblyPipelineFilter = signal<string>('ALL');
  readonly assemblyWindowSearch = signal('');
  readonly assemblySelectedWindowId = signal<string | null>(null);
  readonly assemblyWindowPhotoIdx = signal(0);
  readonly assemblyTogglingWindow = signal(false);

  readonly sawTypeModalSaving = signal(false);

  /** אחרי שמירת מודאל — מסך מוחשך + טבעות אחוזים לפני חזרה לעמדה */
  readonly sawSaveCelebrationCtx = signal<WorkerContext | null>(null);

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

  /** מ״מ לניסור לכל שורה במודאל */
  private readonly sawModalLineMm = signal<Map<string, number>>(new Map());

  private static readonly SAW_MODAL_MM_DEFAULT = 6000;
  private static readonly SAW_MODAL_MM_STEP = 10;
  private static readonly SAW_MODAL_MM_MIN = 1;
  private static readonly SAW_MODAL_MM_MAX = 60000;

  /** תצוגת תמונה מלאה ממודאל סוגי ניסור */
  readonly sawLineImagePreviewUrl = signal<string | null>(null);

  stationId = 1;

  stationLabelKeyFor(
    sid: number,
    order?: ProjectOrder | null,
  ): string {
    return stationLabelKey(order ?? this.context()?.order, sid);
  }

  stationBriefVisualModifier(): string | null {
    return stationVisualModifierClass(this.context()?.order, this.stationId);
  }

  stationBriefVisualStyle(): Record<string, string> {
    return stationVisualStyle(this.context()?.order, this.stationId);
  }

  readonly sawMmMin = WorkerTerminalComponent.SAW_MODAL_MM_MIN;
  readonly sawMmMax = WorkerTerminalComponent.SAW_MODAL_MM_MAX;

  form!: FormGroup;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      if (this.saveToastTimer) {
        clearTimeout(this.saveToastTimer);
        this.saveToastTimer = null;
      }
      if (this.stationCompleteToastTimer) {
        clearTimeout(this.stationCompleteToastTimer);
        this.stationCompleteToastTimer = null;
      }
      if (this.sawSaveCelebrationTimer) {
        clearTimeout(this.sawSaveCelebrationTimer);
        this.sawSaveCelebrationTimer = null;
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
    if (this.stationId === 1) {
      return hasAnySawStationReport(ctx);
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
    const groups = [...map.entries()]
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

    return groups;
  }

  /** תחנות 2–4: TYPE שלא דווח במסורים — נעול (אדום + מנעול) */
  typeGroupLockedByUpstream(ctx: WorkerContext, g: SawTypeGroupVm): boolean {
    if (this.stationId < 2 || this.stationId > 4) return false;
    return this.sawnQtyFromSawLogs(ctx, g) <= 0;
  }

  /** סכום כמויות שדווחו במודאל (מתעדכן בזמן עריכה ואחרי שמירה) */
  modalTypeGroupReportedQty(g: SawTypeGroupVm): number {
    let sum = 0;
    for (const line of g.lines) {
      sum += this.modalLineSawnQty(line.id);
    }
    return sum;
  }

  openSawTypeModal(g: SawTypeGroupVm): void {
    const ctx = this.context();
    if (ctx && this.typeGroupLockedByUpstream(ctx, g)) {
      return;
    }
    if (ctx) {
      this.syncModalCountsFromContext(ctx, g);
    } else {
      this.sawModalLineCounts.set(new Map());
    }

    if (this.stationId === 1 && ctx) {
      const mNext = new Map<string, number>();
      for (const line of g.lines) {
        mNext.set(line.id, this.effectiveSawMmForLine(ctx, line));
      }
      this.sawModalLineMm.set(mNext);
    } else {
      this.sawModalLineMm.set(new Map());
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

  modalLineMm(lineId: string): number {
    return (
      this.sawModalLineMm().get(lineId) ??
      WorkerTerminalComponent.SAW_MODAL_MM_DEFAULT
    );
  }

  /** מ״מ לניסור לשורה: דיווח אחרון, אורך מתכנון, או ברירת מחדל */
  effectiveSawMmForLine(ctx: WorkerContext, line: SawWorkLineDto): number {
    const rawMm = ctx.sawWorkMmByLineId?.[line.id];
    if (typeof rawMm === 'number' && Number.isFinite(rawMm) && rawMm > 0) {
      return this.clampSawModalMm(rawMm);
    }
    const legacyM = ctx.sawWorkMetersByLineId?.[line.id];
    if (typeof legacyM === 'number' && Number.isFinite(legacyM) && legacyM > 0) {
      return this.clampSawModalMm(
        legacyM < 500 ? Math.round(legacyM * 1000) : Math.round(legacyM),
      );
    }
    const planning = line.planningCutLengthMm;
    if (typeof planning === 'number' && Number.isFinite(planning) && planning > 0) {
      return this.clampSawModalMm(planning);
    }
    return WorkerTerminalComponent.SAW_MODAL_MM_DEFAULT;
  }

  private clampSawModalMm(mm: number): number {
    return Math.min(
      WorkerTerminalComponent.SAW_MODAL_MM_MAX,
      Math.max(WorkerTerminalComponent.SAW_MODAL_MM_MIN, Math.round(mm)),
    );
  }

  nudgeModalLineMm(lineId: string, delta: number): void {
    const step = WorkerTerminalComponent.SAW_MODAL_MM_STEP;
    const d = Math.sign(delta) * step;
    this.sawModalLineMm.update((m) => {
      const next = new Map(m);
      const cur =
        next.get(lineId) ?? WorkerTerminalComponent.SAW_MODAL_MM_DEFAULT;
      const n = this.clampSawModalMm(cur + d);
      next.set(lineId, n);
      return next;
    });
  }

  /**
   * אורך צורך (מ״מ) לקורה בשורת מסור: מתכנון (תא פרופיל) כשקיים,
   * אחרת `originalLength` מהפרויקט — כדי שלא יערבבו אורך יחידה כללי עם מטרים לשורה.
   */
  private sawBarNeedLengthMm(
    line: SawWorkLineDto,
    orderOriginalMm: number,
  ): number {
    const p = line.planningCutLengthMm;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return p;
    }
    if (Number.isFinite(orderOriginalMm) && orderOriginalMm > 0) {
      return orderOriginalMm;
    }
    return 0;
  }

  /** פחת (מ״מ) לשורה: צורך לפי כמות×אורך פרופיל מינוס נוסרו×אורך ניסור */
  modalLineRemnantMm(line: SawWorkLineDto): number {
    const ctx = this.context();
    if (!ctx || this.stationId !== 1) return 0;
    const orig = Number(ctx.order.originalLength);
    const perBarNeed = this.sawBarNeedLengthMm(line, orig);
    if (!Number.isFinite(perBarNeed) || perBarNeed <= 0) return 0;
    const sawn = this.modalLineSawnQty(line.id);
    const cutMm = this.modalLineMm(line.id);
    if (!Number.isFinite(cutMm) || cutMm <= 0) return 0;
    return Math.max(0, line.quantity * perBarNeed - sawn * cutMm);
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
      const sawLineMmById: Record<string, number> = {};
      let sumMm = 0;
      for (const line of mg.lines) {
        sawLineSawnById[line.id] = this.modalLineSawnQty(line.id);
        const mm = this.modalLineMm(line.id);
        sawLineMmById[line.id] = mm;
        sumMm += mm;
      }
      const avgMm =
        mg.lines.length > 0
          ? sumMm / mg.lines.length
          : WorkerTerminalComponent.SAW_MODAL_MM_DEFAULT;
      const cutLength = Math.round(Math.max(1, avgMm));

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
              sawLineMmById,
            },
          }),
        );
        await this.reportSawModalScrap(pid, mg.lines);
        const savedCtx = await firstValueFrom(
          this.api.getWorkerContext(sid, pid),
        );
        this.finishSawModalSaveSuccess(savedCtx);
      } catch (err) {
        this.error.set(
          httpErrorMessage(err, 'שמירת ניסור לפי סוג נכשלה — נסה שוב'),
        );
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
      const savedCtx = await firstValueFrom(
        this.api.getWorkerContext(sid, pid),
      );
      this.finishSawModalSaveSuccess(savedCtx);
    } catch (err) {
      this.error.set(httpErrorMessage(err, 'שמירה נכשלה — נסה שוב'));
      this.sawTypeModalSaving.set(false);
    }
  }

  private sawLineProfileCode(line: SawWorkLineDto): string {
    const fromPlanning = line.sawsProfileCode?.trim();
    if (fromPlanning) return normalizeProfileCode(fromPlanning);
    const upper = line.description.toUpperCase();
    for (const code of CATALOG_PROFILE_CODES) {
      if (upper.includes(code)) return code;
    }
    return 'LEGACY';
  }

  /** דיווח פחת לפי פרופיל ואורך — אחרי שמירת מודאל מסורים */
  private async reportSawModalScrap(
    projectId: string,
    lines: SawWorkLineDto[],
  ): Promise<void> {
    const ctx = this.context();
    const orig = Number(ctx?.order.originalLength ?? 0);
    for (const line of lines) {
      const sawn = this.modalLineSawnQty(line.id);
      if (sawn <= 0) continue;
      const perBarNeed = this.sawBarNeedLengthMm(line, orig);
      const cutMm = this.modalLineMm(line.id);
      const remnant = Math.round(perBarNeed - cutMm);
      if (remnant <= 0) continue;
      const profileCode = this.sawLineProfileCode(line);
      await firstValueFrom(
        this.api.postScrap(1, {
          projectId,
          scrapQty: sawn,
          itemLength: remnant,
          profileCode,
          profileKind: profileKindFromCode(profileCode),
        }),
      );
    }
  }

  /** סגירת מודאל, הצגת טבעות התקדמות 3 שניות, ואז משוב רגיל */
  private finishSawModalSaveSuccess(ctx: WorkerContext): void {
    this.closeSawTypeModal();
    this.sawTypeModalSaving.set(false);
    this.applyWorkerContext(ctx);
    if (this.sawSaveCelebrationTimer) {
      clearTimeout(this.sawSaveCelebrationTimer);
      this.sawSaveCelebrationTimer = null;
    }
    this.sawSaveCelebrationCtx.set(ctx);
    this.sawSaveCelebrationTimer = setTimeout(() => {
      this.sawSaveCelebrationCtx.set(null);
      this.sawSaveCelebrationTimer = null;
      this.onReportSaved(ctx);
    }, WorkerTerminalComponent.SAW_SAVE_CELEBRATION_MS);
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

  assemblyCtx(ctx: WorkerContext): AssemblyStationContextDto | null {
    return ctx.assemblyStation ?? null;
  }

  assemblyPipelineTypeKeys(ctx: WorkerContext): string[] {
    const pipe = this.assemblyCtx(ctx)?.pipeline ?? [];
    const keys = new Set<string>();
    for (const line of pipe) {
      const k = (line.instructionKind ?? '').trim();
      if (k) keys.add(k);
    }
    return [...keys].sort(
      (a, b) => sawTypeOrderKey(a) - sawTypeOrderKey(b) || a.localeCompare(b),
    );
  }

  assemblyFilteredPipeline(ctx: WorkerContext): AssemblyPipelineLineDto[] {
    const pipe = this.assemblyCtx(ctx)?.pipeline ?? [];
    const f = this.assemblyPipelineFilter();
    if (f === 'ALL') return pipe;
    return pipe.filter((l) => (l.instructionKind ?? '').trim() === f);
  }

  assemblyPipelineTrackPercents(ctx: WorkerContext): {
    sawPct: number;
    cncPct: number;
    readyPct: number;
  } {
    const pipe = this.assemblyCtx(ctx)?.pipeline ?? [];
    const n = pipe.length || 1;
    let saw = 0;
    let cnc = 0;
    let ready = 0;
    for (const line of pipe) {
      if (line.sawnQty > 0) saw++;
      if (line.cncDoneQty >= line.quantity && line.quantity > 0) cnc++;
      if (line.status === 'ready') ready++;
    }
    return {
      sawPct: Math.round((saw / n) * 100),
      cncPct: Math.round((cnc / n) * 100),
      readyPct: Math.round((ready / n) * 100),
    };
  }

  assemblyPipelineLineTitle(line: AssemblyPipelineLineDto): string {
    if (line.sawsProfileCode) {
      const mm =
        line.planningCutLengthMm != null && line.planningCutLengthMm > 0
          ? ` · ${line.planningCutLengthMm} mm`
          : '';
      return `${line.sawsProfileCode}${mm}`;
    }
    const d = line.description.trim();
    return d.length > 72 ? `${d.slice(0, 69)}…` : d;
  }

  assemblyPipelineTypeLabel(kind: string): string {
    const m = /^TYPE_(\d+)$/i.exec(kind.trim());
    return m ? `TYPE ${m[1]}` : kind.replace(/_/g, ' ');
  }

  setAssemblyPipelineFilter(key: string): void {
    this.assemblyPipelineFilter.set(key);
  }

  assemblyFilteredWindows(ctx: WorkerContext): AssemblyWindowUnitDto[] {
    const q = this.assemblyWindowSearch().trim().toLowerCase();
    const list = this.assemblyCtx(ctx)?.windows ?? [];
    if (!q) return list;
    return list.filter(
      (w) =>
        w.displayLabel.toLowerCase().includes(q) ||
        w.components.some((c) => c.line.toLowerCase().includes(q)),
    );
  }

  assemblySelectedWindow(
    ctx: WorkerContext,
  ): AssemblyWindowUnitDto | null {
    const id = this.assemblySelectedWindowId();
    const list = this.assemblyCtx(ctx)?.windows ?? [];
    if (!id) return list[0] ?? null;
    return list.find((w) => w.id === id) ?? list[0] ?? null;
  }

  selectAssemblyWindow(id: string): void {
    this.assemblySelectedWindowId.set(id);
    this.assemblyWindowPhotoIdx.set(0);
  }

  assemblyWindowPhotoUrl(unit: AssemblyWindowUnitDto | null): string | null {
    if (!unit?.imagePaths?.length) return null;
    const i = Math.min(
      this.assemblyWindowPhotoIdx(),
      unit.imagePaths.length - 1,
    );
    return unit.imagePaths[Math.max(0, i)] ?? null;
  }

  assemblyWindowPhotoCount(unit: AssemblyWindowUnitDto | null): number {
    return unit?.imagePaths?.length ?? 0;
  }

  assemblyWindowPhotoPrev(unit: AssemblyWindowUnitDto | null): void {
    const n = this.assemblyWindowPhotoCount(unit);
    if (n <= 1) return;
    this.assemblyWindowPhotoIdx.update((i) => (i - 1 + n) % n);
  }

  assemblyWindowPhotoNext(unit: AssemblyWindowUnitDto | null): void {
    const n = this.assemblyWindowPhotoCount(unit);
    if (n <= 1) return;
    this.assemblyWindowPhotoIdx.update((i) => (i + 1) % n);
  }

  async saveAssemblyWindowQty(
    unit: AssemblyWindowUnitDto,
    assembledQty: number,
  ): Promise<void> {
    const pid = this.projectSelection.selectedProjectId();
    if (!pid || this.assemblyTogglingWindow()) return;
    this.assemblyTogglingWindow.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.api.setAssemblyWindowQty(pid, unit.id, assembledQty),
      );
      const fresh = await firstValueFrom(
        this.api.getWorkerContext(3, pid),
      );
      this.applyWorkerContext(fresh);
      this.assemblySelectedWindowId.set(unit.id);
    } catch (e: unknown) {
      this.error.set(
        httpErrorMessage(e, 'עדכון כמות הרכבה נכשל — נסה שוב'),
      );
    } finally {
      this.assemblyTogglingWindow.set(false);
    }
  }

  nudgeAssemblyWindowQty(
    unit: AssemblyWindowUnitDto,
    delta: number,
  ): void {
    const next = Math.min(
      unit.quantity,
      Math.max(0, unit.assembledQty + delta),
    );
    if (next === unit.assembledQty) return;
    void this.saveAssemblyWindowQty(unit, next);
  }

  fillAssemblyWindowQty(unit: AssemblyWindowUnitDto): void {
    if (unit.assembledQty >= unit.quantity) return;
    void this.saveAssemblyWindowQty(unit, unit.quantity);
  }

  assemblyWindowsProgressPercent(ctx: WorkerContext): number {
    const a = ctx.assemblyStation;
    if (!a || a.windowsTotalQty <= 0) return 0;
    return Math.min(
      100,
      Math.round((a.windowsAssembledQty / a.windowsTotalQty) * 100),
    );
  }

  assemblyWindowItemPercent(w: AssemblyWindowUnitDto): number {
    if (w.quantity <= 0) return 0;
    return Math.min(100, Math.round((w.assembledQty / w.quantity) * 100));
  }

  /** כמות שנוסרה במסורים לפי שורות (זמין בכל תחנות 1–4) */
  sawnQtyFromSawLogs(ctx: WorkerContext, g: SawTypeGroupVm): number {
    const m = ctx.sawWorkSawnByLineId;
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

  /** כמות שנוסרה לפי סוג (מתוך sawWorkSawnByKind — עמדה 1) */
  sawnQtyForSawTypeGroup(ctx: WorkerContext, g: SawTypeGroupVm): number {
    const m = ctx.sawWorkSawnByKind;
    if (m && g.instructionKind) {
      const v = m[g.instructionKind];
      if (typeof v === 'number' && Number.isFinite(v)) {
        return Math.max(0, Math.floor(v));
      }
    }
    return this.sawnQtyFromSawLogs(ctx, g);
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

  /** פחת (מ״מ) לשורה לפי דיווחי מסור ב־context — כמו המודאל, בלי מפת המודאל */
  lineRemnantMmAtSawFromContext(
    ctx: WorkerContext,
    line: SawWorkLineDto,
  ): number {
    const orig = Number(ctx.order.originalLength);
    const perBarNeed = this.sawBarNeedLengthMm(line, orig);
    if (!Number.isFinite(perBarNeed) || perBarNeed <= 0) return 0;
    const rawS = ctx.sawWorkSawnByLineId?.[line.id];
    const sawn =
      typeof rawS === 'number' && Number.isFinite(rawS)
        ? Math.max(0, Math.floor(rawS))
        : 0;
    const cutMm = this.effectiveSawMmForLine(ctx, line);
    if (!Number.isFinite(cutMm) || cutMm <= 0) return 0;
    return Math.max(0, line.quantity * perBarNeed - sawn * cutMm);
  }

  /** סה״כ פחת משוער (מ״מ) לכל שורות קבוצת TYPE — מצטבר ממסורים */
  typeGroupRemnantMm(ctx: WorkerContext, g: SawTypeGroupVm): number {
    return g.lines.reduce(
      (s, line) => s + this.lineRemnantMmAtSawFromContext(ctx, line),
      0,
    );
  }

  typeGroupShowsRemnant(ctx: WorkerContext, g: SawTypeGroupVm): boolean {
    return this.typeGroupRemnantMm(ctx, g) > 0;
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
        sawWorkMmByLineId: ctx.sawWorkMmByLineId ?? {},
        sawWorkMetersByLineId: ctx.sawWorkMetersByLineId ?? {},
        workLineDoneByLineId: ctx.workLineDoneByLineId ?? {},
      });
      this.syncPackExtraSlots(ctx);
      if (res.complete) {
        this.doneMsg.set(true);
        this.scrollToProgress();
      }
      this.onReportSaved(ctx);
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

  private isStationComplete(ctx: WorkerContext): boolean {
    if (this.stationId === 6) {
      return ctx.packReport?.complete === true;
    }
    return this.stationProgress(ctx).percent >= 100;
  }

  private onReportSaved(ctx: WorkerContext): void {
    const wasComplete = this.stationWasComplete;
    const nowComplete = this.isStationComplete(ctx);
    this.stationWasComplete = nowComplete;
    if (nowComplete && !wasComplete) {
      this.showStationCompleteToast();
      return;
    }
    this.showSaveToast();
  }

  private showStationCompleteToast(): void {
    if (this.stationCompleteToastTimer) {
      clearTimeout(this.stationCompleteToastTimer);
      this.stationCompleteToastTimer = null;
    }
    this.saveToastVisible.set(false);
    this.stationCompleteToastVisible.set(true);
    this.stationCompleteToastTimer = setTimeout(() => {
      this.stationCompleteToastVisible.set(false);
      this.stationCompleteToastTimer = null;
    }, 5000);
  }

  dismissStationCompleteToast(): void {
    if (this.stationCompleteToastTimer) {
      clearTimeout(this.stationCompleteToastTimer);
      this.stationCompleteToastTimer = null;
    }
    this.stationCompleteToastVisible.set(false);
  }

  private showSaveToast(): void {
    if (this.saveToastTimer) {
      clearTimeout(this.saveToastTimer);
      this.saveToastTimer = null;
    }
    this.stationCompleteToastVisible.set(false);
    this.saveToastVisible.set(true);
    this.saveToastTimer = setTimeout(() => {
      this.saveToastVisible.set(false);
      this.saveToastTimer = null;
    }, 4200);
  }

  scrapMm(): number {
    const ctx = this.context();
    if (!ctx || this.stationId !== 1 || !this.form) return 0;
    const target =
      ctx.sawWorkTargetQty != null && ctx.sawWorkTargetQty > 0
        ? ctx.sawWorkTargetQty
        : ctx.order.totalItems;
    const orig = Number(ctx.order.originalLength);
    const pq = Number(this.form.get('barsQty')?.value ?? 0);
    const cutMm = Number(this.form.get('cutLengthMm')?.value ?? 0);
    if (!target || !orig || !cutMm) return 0;
    return Math.max(0, target * orig - pq * cutMm);
  }

  private syncModalCountsFromContext(
    ctx: WorkerContext,
    g: SawTypeGroupVm,
  ): void {
    const fromApi =
      this.stationId === 1
        ? ctx.sawWorkSawnByLineId
        : ctx.workLineDoneByLineId;
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
  }

  private applyWorkerContext(
    ctx: WorkerContext,
    opts?: { keepModalOpen?: boolean },
  ): void {
    this.context.set({
      ...ctx,
      activityLog: ctx.activityLog ?? [],
      sawWorkSawnByKind: ctx.sawWorkSawnByKind ?? {},
      sawWorkSawnByLineId: ctx.sawWorkSawnByLineId ?? {},
      sawWorkMmByLineId: ctx.sawWorkMmByLineId ?? {},
      sawWorkMetersByLineId: ctx.sawWorkMetersByLineId ?? {},
      workLineDoneByLineId: ctx.workLineDoneByLineId ?? {},
      assemblyStation: ctx.assemblyStation ?? null,
    });
    this.managerPhotoFailed.set(false);
    this.teamPhotoFailedIdx.set(new Set());

    if (this.stationId === 3 && ctx.assemblyStation?.windows.length) {
      const cur = this.assemblySelectedWindowId();
      if (
        !cur ||
        !ctx.assemblyStation.windows.some((w) => w.id === cur)
      ) {
        this.assemblySelectedWindowId.set(
          ctx.assemblyStation.windows[0].id,
        );
        this.assemblyWindowPhotoIdx.set(0);
      }
    }

    const mg = this.sawTypeModalGroup();
    if (opts?.keepModalOpen && mg) {
      this.syncModalCountsFromContext(ctx, mg);
      if (this.stationId === 1) {
        const mNext = new Map<string, number>();
        for (const line of mg.lines) {
          mNext.set(line.id, this.effectiveSawMmForLine(ctx, line));
        }
        this.sawModalLineMm.set(mNext);
      }
    } else {
      this.closeSawTypeModal();
    }

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
          this.applyWorkerContext(ctx);
          this.stationWasComplete = this.isStationComplete(ctx);
          this.loading.set(false);
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
      const cutMm = Number(raw['cutLengthMm']);
      logBody['cutLength'] = Math.round(cutMm);
    }
    if (extraPayload) {
      logBody['extraPayload'] = extraPayload;
    }

    try {
      if (sid === 1) {
        const auto = this.scrapMm();
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
        sawWorkMmByLineId: ctx.sawWorkMmByLineId ?? {},
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
      this.onReportSaved(ctx);
    } catch {
      this.error.set('שמירה נכשלה');
    } finally {
      this.saving.set(false);
    }
  }
}
