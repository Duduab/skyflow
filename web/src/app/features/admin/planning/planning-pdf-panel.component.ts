import { NgTemplateOutlet } from '@angular/common';
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
  AssemblyWindowPartsDto,
  FacadeDirection,
  FacadeGroupPreviewDto,
  PlanningPdfKind,
  PlanningPdfPreviewDto,
  ProjectAngleSourcing,
  ProjectFlowStatus,
  ProjectLineMaterial,
  WindowTypePreviewDto,
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
    NgTemplateOutlet,
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
  /** Planner launched a specific unit from the elevation popup (→ step 3, open it). */
  readonly wizardLaunchUnit = output<string>();

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

  /** כל סוגי החלון לבחירה בפופאפ (לא מעומד). */
  readonly windowTypesForPicker = computed(
    () => this.preview()?.windowTypes ?? [],
  );

  openWindowPicker(): void {
    if (!this.quantitiesReady()) return;
    this.expandedWindowTypeId.set(null);
    this.windowPickerOpen.set(true);
  }

  closeWindowPicker(): void {
    this.windowPickerOpen.set(false);
    this.expandedWindowTypeId.set(null);
  }

  toggleRowUploader(windowTypeId: string): void {
    this.expandedWindowTypeId.update((cur) =>
      cur === windowTypeId ? null : windowTypeId,
    );
  }

  isRowUploading(windowTypeId: string, kind: PlanningPdfKind): boolean {
    return this.uploadingRowKey() === `${windowTypeId}:${kind}`;
  }

  // ── Parts mapping review/edit (page-2 set tables) ─────────────────────────
  /** windowTypeId whose parts mapping is currently open in the editor. */
  readonly editingPartsId = signal<string | null>(null);
  /** Working copy of the mapping being edited (committed only on save). */
  readonly partsDraft = signal<AssemblyWindowPartsDto | null>(null);
  readonly savingParts = signal(false);

  /** Total number of mapped part rows for a window type (for the badge). */
  partsRowCount(w: WindowTypePreviewDto): number {
    return (w.parts?.sections ?? []).reduce((n, s) => n + s.rows.length, 0);
  }

  openPartsEditor(w: WindowTypePreviewDto): void {
    const source: AssemblyWindowPartsDto = w.parts
      ? (JSON.parse(JSON.stringify(w.parts)) as AssemblyWindowPartsDto)
      : { sections: [] };
    this.partsDraft.set(source);
    this.editingPartsId.set(w.id);
  }

  closePartsEditor(): void {
    this.editingPartsId.set(null);
    this.partsDraft.set(null);
  }

  /** In-place text edit of a single cell (value binding keeps the input synced). */
  updatePartCell(
    si: number,
    ri: number,
    field: 'partNumber' | 'description' | 'blockNumber',
    value: string,
  ): void {
    const draft = this.partsDraft();
    const row = draft?.sections?.[si]?.rows?.[ri];
    if (row) row[field] = value;
  }

  updateSectionTitle(si: number, value: string): void {
    const draft = this.partsDraft();
    const sec = draft?.sections?.[si];
    if (sec) sec.title = value;
  }

  addPartRow(si: number): void {
    this.partsDraft.update((d) => {
      if (!d) return d;
      const next = JSON.parse(JSON.stringify(d)) as AssemblyWindowPartsDto;
      next.sections[si]?.rows.push({
        partNumber: '',
        description: '',
        blockNumber: '',
      });
      return next;
    });
  }

  removePartRow(si: number, ri: number): void {
    this.partsDraft.update((d) => {
      if (!d) return d;
      const next = JSON.parse(JSON.stringify(d)) as AssemblyWindowPartsDto;
      next.sections[si]?.rows.splice(ri, 1);
      return next;
    });
  }

  addPartSection(): void {
    this.partsDraft.update((d) => {
      const base = d ?? { sections: [] };
      const next = JSON.parse(JSON.stringify(base)) as AssemblyWindowPartsDto;
      next.sections.push({ key: 'OTHER', title: '', rows: [] });
      return next;
    });
  }

  removePartSection(si: number): void {
    this.partsDraft.update((d) => {
      if (!d) return d;
      const next = JSON.parse(JSON.stringify(d)) as AssemblyWindowPartsDto;
      next.sections.splice(si, 1);
      return next;
    });
  }

  savePartsEditor(w: WindowTypePreviewDto): void {
    const id = this.projectId();
    const draft = this.partsDraft();
    if (!id || !draft) return;
    this.savingParts.set(true);
    this.error.set(null);
    this.api
      .saveWindowTypeParts(id, w.id, draft)
      .pipe(finalize(() => this.savingParts.set(false)))
      .subscribe({
        next: (res) => {
          this.preview.set(res.preview);
          this.closePartsEditor();
          this.planningChanged.emit();
        },
        error: (err) =>
          this.error.set(httpErrorMessage(err, 'Save failed')),
      });
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
    this.uploadWindowTypeDoc(windowTypeId, kind, file);
  }

  /** Upload triggered from inside the elevation-map cell popup. */
  onMapDocUpload(e: {
    windowTypeId: string;
    kind: PlanningPdfKind;
    file: File;
  }): void {
    this.uploadWindowTypeDoc(e.windowTypeId, e.kind, e.file);
  }

  private uploadWindowTypeDoc(
    windowTypeId: string,
    kind: PlanningPdfKind,
    file: File,
  ): void {
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
      if (!id || (flow !== 'PENDING_PLANNING' && flow !== 'IN_PRODUCTION')) {
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
    const ready = this.quantitiesReady();
    // כמויות + Stages תמיד ראשון — הוא שמזין את החזיתות והשלבים ומשחרר את השאר.
    // מפת החזיתות אינה סלוט גנרי אלא צ'ק-ליסט per-facade (ראה למטה).
    // הוראות ANG — per יחידה בלבד (pdf-panel__u-card), לא סלוט גלובלי.
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

  /** Which direction groups in the elevation checklist are expanded. */
  private readonly elevDirExpanded = signal<ReadonlySet<FacadeDirection>>(new Set());

  isElevDirExpanded(direction: FacadeDirection): boolean {
    return this.elevDirExpanded().has(direction);
  }

  toggleElevDir(direction: FacadeDirection): void {
    this.elevDirExpanded.update((prev) => {
      const next = new Set(prev);
      if (next.has(direction)) next.delete(direction);
      else next.add(direction);
      return next;
    });
  }

  elevDirPanelId(direction: FacadeDirection): string {
    return `pdf-panel-elev-dir-${direction.toLowerCase()}`;
  }

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
    () => {
      const preview = this.preview();
      return !!preview?.windowTypes.some(
        (window) => !!window.instructionPdfUrl,
      );
    },
  );

  /** סלוטים גלובליים — קובץ אחד בכל העלאה (ANG per יחידה בלבד). */
  isMultiKind(_kind: PlanningPdfKind): boolean {
    return false;
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

  /** From the elevation popup: close the map and jump to step 3 for this unit. */
  onLaunchUnit(e: { windowTypeId: string; code: string }): void {
    this.closeGroupMap();
    this.wizardLaunchUnit.emit(e.windowTypeId);
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
