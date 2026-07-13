import { NgClass } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { from } from 'rxjs';
import { concatMap, finalize, take } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import { httpErrorMessage } from '../../../core/http-error.util';
import {
  FacadeDirection,
  FacadeGroupPreviewDto,
  PlanningPdfKind,
  PlanningPdfPreviewDto,
  ProjectAngleSourcing,
  ProjectFlowStatus,
  ProjectLineMaterial,
} from '../../../core/skyflow.models';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { ElevationMapComponent } from '../../elevation/elevation-map.component';

interface PdfSlot {
  kind: PlanningPdfKind;
  titleKey: string;
  descKey: string;
  done: boolean;
  /** Locked until the quantities + stages file is uploaded and parsed. */
  locked: boolean;
}

@Component({
  selector: 'skyflow-planning-pdf-panel',
  standalone: true,
  imports: [
    TranslateModule,
    NgClass,
    UiButtonComponent,
    ElevationMapComponent,
  ],
  templateUrl: './planning-pdf-panel.component.html',
  styleUrl: './planning-pdf-panel.component.scss',
})
export class PlanningPdfPanelComponent {
  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);

  readonly projectId = input<string | null>(null);
  readonly flowStatus = input<ProjectFlowStatus | null>(null);
  readonly wizardMode = input<'uploadPreview' | 'summaryApprove'>(
    'uploadPreview',
  );
  readonly angleSourcing = input<ProjectAngleSourcing>('INTERNAL_LASER');
  readonly lineMaterial = input<ProjectLineMaterial>('ALUMINUM');
  readonly planningSawsManagerUserId = input<string | null>(null);
  readonly sawsWorkerUserIds = input<readonly string[]>([]);

  readonly planningChanged = output<void>();
  readonly planningApproved = output<void>();
  readonly wizardContinue = output<void>();

  readonly preview = signal<PlanningPdfPreviewDto | null>(null);
  readonly uploadingKind = signal<PlanningPdfKind | null>(null);
  readonly approving = signal(false);
  readonly error = signal<string | null>(null);

  /** מסגריה (פלדה): טופס הוספת נספח פרטי חיבור וזוויות */
  readonly steelTitle = signal('');
  readonly steelTarget = signal<number | null>(null);

  /** האם הפרויקט כולל תחנת מסגריה (חומר קו = פלדה). */
  readonly isSteelwork = computed(() => this.lineMaterial() === 'STEEL');

  readonly steelworkDetails = computed(
    () => this.preview()?.steelworkDetails ?? [],
  );

  /** פירוק כמויות — עימוד טבלת סוגי החלון */
  readonly windowPageSize = 8;
  readonly windowPageIndex = signal(0);

  /** סוגי החלון בעמוד הנוכחי בלבד */
  readonly pagedWindowTypes = computed(() => {
    const list = this.preview()?.windowTypes ?? [];
    const size = this.windowPageSize;
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(this.windowPageIndex(), totalPages - 1);
    return list.slice(page * size, page * size + size);
  });

  /** מטא־עימוד לטבלת פירוק הכמויות */
  readonly windowPagerMeta = computed(() => {
    const total = this.preview()?.windowTypes.length ?? 0;
    const size = this.windowPageSize;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(this.windowPageIndex(), totalPages - 1);
    const start = page * size;
    return {
      total,
      totalPages,
      page: page + 1,
      from: total === 0 ? 0 : start + 1,
      to: Math.min(total, start + size),
      showPager: total > size,
    };
  });

  /** סכום כמויות כל השלבים — לחישוב החלק היחסי בכל שלב */
  readonly stagesTotalQty = computed(() =>
    (this.preview()?.stages ?? []).reduce(
      (sum, s) => sum + (s.totalQty || 0),
      0,
    ),
  );

  prevWindowPage(): void {
    this.windowPageIndex.update((i) => Math.max(0, i - 1));
  }

  nextWindowPage(): void {
    const meta = this.windowPagerMeta();
    if (!meta.showPager) return;
    this.windowPageIndex.update((i) => Math.min(meta.totalPages - 1, i + 1));
  }

  /** אחוז החלק היחסי של שלב מסך כל הכמויות (לפס ההתקדמות). */
  stageShare(qty: number): number {
    const total = this.stagesTotalQty();
    if (total <= 0) return 0;
    return Math.round((qty / total) * 100);
  }

  /** שורת סוג-חלון פתוחה להעלאת קבצים (per-יחידה). */
  readonly expandedWindowTypeId = signal<string | null>(null);
  /** מפתח `${windowTypeId}:${kind}` של ההעלאה שרצה כרגע. */
  readonly uploadingRowKey = signal<string | null>(null);

  /** popup בחירת חלון עבור כפתור "הוראות ייצור לחלון" הראשי. */
  readonly windowPickerOpen = signal(false);

  openWindowPicker(): void {
    if (!this.quantitiesReady()) return;
    this.windowPickerOpen.set(true);
  }

  closeWindowPicker(): void {
    this.windowPickerOpen.set(false);
  }

  toggleRowUploader(windowTypeId: string): void {
    this.expandedWindowTypeId.update((cur) =>
      cur === windowTypeId ? null : windowTypeId,
    );
  }

  isRowUploading(windowTypeId: string, kind: PlanningPdfKind): boolean {
    return this.uploadingRowKey() === `${windowTypeId}:${kind}`;
  }

  /** מצב קבצי ה-ANG של יחידה: לכל קוד — האם כבר הועלה קובץ הוראות. */
  angleStatusForWindow(
    codes: string[],
  ): { code: string; hasPdf: boolean; url: string | null }[] {
    const byCode = new Map((this.preview()?.angles ?? []).map((a) => [a.code, a]));
    return codes.map((code) => {
      const a = byCode.get(code);
      return { code, hasPdf: !!a?.instructionPdfUrl, url: a?.instructionPdfUrl ?? null };
    });
  }

  /** העלאת PDF ליחידה בודדת (הוראות ייצור / נספח חיבור / ANG). */
  onWindowTypeFileSelected(
    windowTypeId: string,
    kind: PlanningPdfKind,
    fileList: FileList | null,
  ): void {
    const file = fileList && fileList.length ? fileList[0] : null;
    if (!file) return;
    const id = this.projectId();
    if (!id) return;
    this.uploadingRowKey.set(`${windowTypeId}:${kind}`);
    this.error.set(null);
    this.api
      .uploadWindowTypePdf(id, windowTypeId, file, kind)
      .pipe(finalize(() => this.uploadingRowKey.set(null)))
      .subscribe({
        next: (res) => {
          this.preview.set(res.preview);
          this.planningChanged.emit();
        },
        error: (err) =>
          this.error.set(httpErrorMessage(err, 'Upload or parse failed')),
      });
  }

  constructor() {
    effect((onCleanup) => {
      const id = this.projectId();
      const flow = this.flowStatus();
      if (!id || flow !== 'PENDING_PLANNING') {
        this.preview.set(null);
        return;
      }
      const sub = this.api.getPlanningPdfPreview(id).subscribe({
        next: (p) => {
          if (this.projectId() === id) {
            this.preview.set(p);
            this.windowPageIndex.set(0);
          }
        },
        error: () => {
          if (this.projectId() === id) this.preview.set(null);
        },
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  private slotDone(kind: PlanningPdfKind): boolean {
    const p = this.preview();
    if (!p) return false;
    switch (kind) {
      case 'ELEVATION_MAP':
        return p.elevationCellCount > 0;
      case 'WINDOW_INSTRUCTION_PDF':
        return p.windowTypes.some((w) => !!w.instructionPdfUrl);
      case 'QUANTITIES_PDF':
        return p.stages.length > 0 || p.windowTypes.some((w) => w.totalQty > 0);
      case 'ANGLE_INSTRUCTION_PDF':
        return p.angles.length > 0;
      case 'CONNECTION_DETAILS_PDF':
        return (p.steelworkDetails?.length ?? 0) > 0;
    }
  }

  /** Quantities + Stages must be uploaded/parsed first; it unlocks the rest. */
  readonly quantitiesReady = computed(() => {
    const p = this.preview();
    if (!p) return false;
    return p.stages.length > 0 || p.facadeCount > 0;
  });

  readonly slots = computed((): PdfSlot[] => {
    const angDetected = (this.preview()?.angles.length ?? 0) > 0;
    const ready = this.quantitiesReady();
    // כמויות + Stages תמיד ראשון — הוא שמזין את החזיתות והשלבים ומשחרר את השאר.
    // מפת החזיתות אינה סלוט גנרי אלא צ'ק-ליסט per-facade (ראה למטה).
    const defs: Omit<PdfSlot, 'done' | 'locked'>[] = [
      {
        kind: 'QUANTITIES_PDF',
        titleKey: 'PLANNING_PDF.SLOT_QUANTITIES_TITLE',
        descKey: 'PLANNING_PDF.SLOT_QUANTITIES_DESC',
      },
      {
        kind: 'WINDOW_INSTRUCTION_PDF',
        titleKey: 'PLANNING_PDF.SLOT_WINDOW_TITLE',
        descKey: 'PLANNING_PDF.SLOT_WINDOW_DESC',
      },
      // סלוט העלאת ה-ANG מוצג רק כשזוהה ANG בקובץ הוראות החלונות.
      ...(angDetected
        ? [
            {
              kind: 'ANGLE_INSTRUCTION_PDF' as const,
              titleKey: 'PLANNING_PDF.SLOT_ANGLE_TITLE',
              descKey: 'PLANNING_PDF.SLOT_ANGLE_DESC',
            },
          ]
        : []),
    ];
    return defs.map((d) => ({
      ...d,
      done: this.slotDone(d.kind),
      locked: d.kind !== 'QUANTITIES_PDF' && !ready,
    }));
  });

  /** Human-readable direction label key for the stages element. */
  directionKey(dir: FacadeDirection): string {
    return `PLANNING_PDF.DIR_${dir}`;
  }

  /** The facade group whose elevation map is currently uploading. */
  readonly uploadingGroupKey = signal<string | null>(null);

  /** קבוצת החזית שמפתה נפתחת ב-popup המפה האינטראקטיבית (או null כשסגור). */
  readonly mapModalGroup = signal<string | null>(null);

  /** פתיחת מפת החזיתות האינטראקטיבית (מלבנים לחיצים + סבב עבודה) לקבוצה. */
  openGroupMap(groupKey: string): void {
    if (!this.projectId()) return;
    this.mapModalGroup.set(groupKey);
  }

  closeGroupMap(): void {
    this.mapModalGroup.set(null);
  }

  private readonly DIRECTION_ORDER: FacadeDirection[] = [
    'SOUTH',
    'NORTH',
    'WEST',
    'EAST',
  ];

  /** Facade groups by direction — drives the per-group elevation checklist. */
  readonly facadeGroupsByDirection = computed(
    (): { direction: FacadeDirection; groups: FacadeGroupPreviewDto[] }[] => {
      const groups = this.preview()?.facadeGroups ?? [];
      return this.DIRECTION_ORDER.map((direction) => ({
        direction,
        groups: groups.filter((g) => g.direction === direction),
      })).filter((d) => d.groups.length > 0);
    },
  );

  /** Facade groups still missing an elevation map (soft warning, not blocking). */
  readonly missingElevationCount = computed(() => {
    const p = this.preview();
    if (!p) return 0;
    return Math.max(0, p.facadeGroupCount - p.facadeGroupsWithElevation);
  });

  onFacadeGroupElevationSelected(
    groupKey: string,
    fileList: FileList | null,
  ): void {
    const file = fileList && fileList.length ? fileList[0] : null;
    if (!file) return;
    const id = this.projectId();
    if (!id) return;
    this.uploadingGroupKey.set(groupKey);
    this.error.set(null);
    this.api
      .uploadFacadeGroupElevation(id, groupKey, file)
      .pipe(finalize(() => this.uploadingGroupKey.set(null)))
      .subscribe({
        next: (res) => {
          this.preview.set(res.preview);
          this.planningChanged.emit();
        },
        error: (err) =>
          this.error.set(httpErrorMessage(err, 'Upload or parse failed')),
      });
  }

  /** קודי ANG שזוהו מהשרטוט אך עדיין חסר להם קובץ הוראות. */
  readonly missingAngles = computed(() =>
    (this.preview()?.angles ?? []).filter((a) => !a.instructionPdfUrl),
  );

  readonly requiresAngleUpload = computed(
    () =>
      this.angleSourcing() === 'INTERNAL_LASER' &&
      this.missingAngles().length > 0,
  );

  missingAnglesLabel(): string {
    return this.missingAngles()
      .map((a) => a.code)
      .join(', ');
  }

  readonly canContinue = computed(
    () =>
      (this.preview()?.windowTypeCount ?? 0) > 0 && !this.requiresAngleUpload(),
  );

  /** סלוט ANG מאפשר כמה קבצים (ANG-1A, ANG-1B ...); שאר הסלוטים — קובץ אחד. */
  isMultiKind(kind: PlanningPdfKind): boolean {
    return kind === 'ANGLE_INSTRUCTION_PDF';
  }

  onFilesSelected(kind: PlanningPdfKind, fileList: FileList | null): void {
    // Everything except the quantities file is locked until quantities parsed.
    if (kind !== 'QUANTITIES_PDF' && !this.quantitiesReady()) return;
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    this.uploadFiles(kind, this.isMultiKind(kind) ? files : [files[0]]);
  }

  /** מעלה את הקבצים בזה אחר זה (append בשרת) ומעדכן את התצוגה המקדימה. */
  private uploadFiles(kind: PlanningPdfKind, files: File[]): void {
    const id = this.projectId();
    if (!id) return;
    this.uploadingKind.set(kind);
    this.error.set(null);
    from(files)
      .pipe(
        concatMap((file) => this.api.uploadPlanningPdf(id, file, kind)),
        finalize(() => this.uploadingKind.set(null)),
      )
      .subscribe({
        next: (res) => {
          this.preview.set(res.preview);
          this.windowPageIndex.set(0);
          this.planningChanged.emit();
        },
        error: (err) =>
          this.error.set(httpErrorMessage(err, 'Upload or parse failed')),
      });
  }

  /** מסגריה: העלאת קובץ נספח בודד עם כותרת ויעד אופציונליים. */
  onSteelworkFileSelected(fileList: FileList | null): void {
    const file = fileList && fileList.length ? fileList[0] : null;
    if (!file) return;
    const id = this.projectId();
    if (!id) return;
    this.uploadingKind.set('CONNECTION_DETAILS_PDF');
    this.error.set(null);
    const title = this.steelTitle().trim() || undefined;
    const target = this.steelTarget();
    this.api
      .uploadPlanningPdf(
        id,
        file,
        'CONNECTION_DETAILS_PDF',
        title,
        target != null && target > 0 ? target : undefined,
      )
      .pipe(finalize(() => this.uploadingKind.set(null)))
      .subscribe({
        next: (res) => {
          this.preview.set(res.preview);
          this.steelTitle.set('');
          this.steelTarget.set(null);
          this.planningChanged.emit();
        },
        error: (err) =>
          this.error.set(httpErrorMessage(err, 'Upload or parse failed')),
      });
  }

  onSteelTitleInput(value: string): void {
    this.steelTitle.set(value);
  }

  onSteelTargetInput(value: string): void {
    const n = Number(value);
    this.steelTarget.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : null);
  }

  onContinue(): void {
    this.wizardContinue.emit();
  }

  approve(): void {
    const id = this.projectId();
    if (!id) return;
    this.approving.set(true);
    this.error.set(null);
    this.api
      .postApprovePlanning(id, {
        planningSawsManagerUserId: this.planningSawsManagerUserId() ?? null,
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
        error: (err) => this.error.set(httpErrorMessage(err, 'Approval failed')),
      });
  }
}
