export type ProjectFlowStatus =
  | 'PENDING_PLANNING'
  | 'IN_PRODUCTION'
  | 'COMPLETED';

export type OrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD';

export type ProjectLineMaterial = 'ALUMINUM' | 'STEEL';
export type ProjectMachiningRoute = 'GLASS' | 'ALU_RANGER';
export type ProjectAngleSourcing = 'INTERNAL_LASER' | 'EXTERNAL_SUPPLIER' | 'NO_LASER';

export interface ProjectOrder {
  id: string;
  name: string;
  totalItems: number;
  requirements: string;
  status: OrderStatus;
  flowStatus: ProjectFlowStatus;
  originalLength: string | number;
  /** אלומיניום → מסורים; פלדה → מסגריה (תחנה 1) */
  lineMaterial?: ProjectLineMaterial;
  /** זכוכית → CNC; Alu Ranger → תחנה 2 וריאנט */
  machiningRoute?: ProjectMachiningRoute;
  /** משווה מתכנון (עמדת מסורים) — תאימות לאחור */
  planningAssigneeUserId?: string | null;
  /** מנהל מסורים משובץ מתכנון (עמדה 1) */
  planningSawsManagerUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface StationTotal {
  stationId: number;
  processedQty: number;
}

export interface ScrapTotal {
  stationId: number;
  scrapQty: number;
}

export interface SummaryStationRow {
  stationId: number;
  labelKey: string;
  processedQty: number;
  scrapQty: number;
}

export interface SiteAssemblyContext {
  deliveryNoteUrl: string | null;
  expectedBeams: number;
  expectedGlazing: number;
  expectedUnitized: number;
  assembledBeams: number;
  assembledGlazing: number;
  assembledUnitized: number;
  shippingType?: 'INTERNAL' | 'EXTERNAL' | null;
  externalPrice?: string | null;
  noteNumber?: string | null;
  issuedAt?: string | null;
  awaitingDeliveryNote?: boolean;
  hasNewDeliveryNote?: boolean;
  deliveryNotes?: SiteDeliveryNoteBrief[];
}

export interface SiteDeliveryNoteBrief {
  id: string;
  noteNumber: string;
  documentUrl: string;
  shippingType: 'INTERNAL' | 'EXTERNAL';
  externalPrice: string | null;
  issuedAt: string;
}

export interface SawWorkLineDto {
  id: string;
  componentKind: string;
  description: string;
  quantity: number;
  sortOrder: number;
  /** TYPE_2, TYPE_4, … — לא WINDOW_INSTRUCTION */
  instructionKind?: string;
  /** נתיבים ציבוריים לתמונות (אחרי אישור תפ״י) */
  imagePaths?: string[];
  /** אורך חיתוך מהתכנון (מ״מ) — מתא Excel; מקור למטרים לניסור */
  planningCutLengthMm?: number | null;
  /** MPS-X | MPS-Y | MPB-X | MPB-Y */
  sawsProfileCode?: string | null;
}

export interface WorkerStationManagerDisplayDto {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

export interface WorkerActivityLogEntryDto {
  id: string;
  createdAt: string;
  stationId: number;
  stationManagerName: string;
  reporterName: string | null;
  processedQty: number;
  summaryKey: string;
  summaryParams: Record<string, string | number>;
  issues: string | null;
}

export interface WorkerContext {
  order: ProjectOrder;
  stationId: number;
  previousQty: number;
  totals: StationTotal[];
  scrapByStation: ScrapTotal[];
  summaryStations: SummaryStationRow[];
  packedQty: number;
  requiredPackQty: number;
  readyToShip: boolean;
  /** Station 1 — סכום כמויות חיתוך מהתכנון (MPS/MPB) ליעד התקדמות */
  sawWorkTargetQty?: number;
  /** דיווחים לכל התחנות בפרויקט — מהחדש לישן */
  activityLog?: WorkerActivityLogEntryDto[];
  /** מנהל/משווה להצגה במסוף — מהמערכת או משיבוץ תכנון (עמדה 1) */
  stationManagerDisplay?: WorkerStationManagerDisplayDto | null;
  /** Station 1 — קווי עבודה למסורים אחרי אישור תכנון */
  sawWorkLines?: SawWorkLineDto[];
  /**
   * Station 1 — כמה נוסרו לפי instructionKind (TYPE_2, …).
   * מוכן לדיווח עתידי לפי סוג; כרגע יכול להיות ריק או אפסים.
   */
  sawWorkSawnByKind?: Record<string, number>;
  /**
   * Station 1 — כמה נוסרו לפי מזהה שורת מסור (מדיווחי מודאל TYPE).
   * Stations 2–4 — אותם נתונים לתצוגת פחת משוער מתחנת המסורים.
   */
  sawWorkSawnByLineId?: Record<string, number>;
  /**
   * Station 1 — מטרים לניסור לכל שורת מסור (מדיווחי מודאל TYPE).
   * Stations 2–4 — לתצוגת פחת משוער.
   */
  /** אורך ניסור אחרון לשורה (מ״מ) */
  sawWorkMmByLineId?: Record<string, number>;
  /** @deprecated נשמר במטרים בדיווחים ישנים — API ממיר ל־mm */
  sawWorkMetersByLineId?: Record<string, number>;
  /**
   * Stations 2–4 — כמה דווחו לפי מזהה שורת תכנון (מודאל TYPE, ללא מטרים).
   */
  workLineDoneByLineId?: Record<string, number>;
  /** Station 1 — עובדי מסורים משובצים מתכנון (מרובים) */
  planningSawsTeam?: WorkerStationManagerDisplayDto[];
  /** Station 7 — הרכבה באתר */
  siteAssembly?: SiteAssemblyContext | null;
  /** Station 6 — תמונות סידור ואריזה */
  packReport?: PackReportContext | null;
  /** Station 6 — תעודת משלוח */
  deliveryNote?: DeliveryNoteContext | null;
  /** Station 3 — הרכבה: קו ייצור + הוראות חלונות */
  assemblyStation?: AssemblyStationContextDto | null;
  /** Station 4 — הדבקות לפי TYPE וקודי GL */
  gluingStation?: GluingStationContextDto | null;
  /** Station 8 — לייזר: קובצי ANG + כמויות */
  laserStation?: LaserStationContextDto | null;
  /** Station 1 (פלדה) — מסגריה: נספחי פרטי חיבור וזוויות + כמויות */
  steelworkStation?: SteelworkStationContextDto | null;
  /** Station 3 — סוגי חלונות עם הוראות ייצור (זרימת 4 PDF) */
  assemblyWindowTypes?: AssemblyWindowTypeDocDto[];
  /** Station 3 — persisted parts-mapping checklist per unit */
  assemblyPartsCheck?: AssemblyPartsCheckDto;
  /** פגמים שהוחזרו לתחנה זו ממפת החזיתות */
  reworkDefects?: ReworkDefectDto[];
}

export interface LaserAngleDto {
  code: string;
  qty: number;
  doneQty: number;
  instructionPdfUrl: string | null;
  instructionPage: number | null;
}

export interface LaserStationContextDto {
  angles: LaserAngleDto[];
  totalAngleQty: number;
  doneQty: number;
  externalSupplier: boolean;
}

export interface SteelworkDetailDto {
  id: string;
  title: string;
  targetQty: number;
  doneQty: number;
  instructionPdfUrl: string | null;
}

export interface SteelworkStationContextDto {
  details: SteelworkDetailDto[];
  totalTargetQty: number;
  doneQty: number;
}

export interface AssemblyWindowPartRow {
  partNumber: string;
  description: string;
  blockNumber: string;
}

export interface AssemblyWindowPartSection {
  key: string;
  title: string;
  rows: AssemblyWindowPartRow[];
}

export interface AssemblyWindowPartsDto {
  sections: AssemblyWindowPartSection[];
}

export type GlassPanelKind = 'WINDOW' | 'FIXED';

export interface GlassPanelDto {
  code: string;
  kind: GlassPanelKind;
  imagePath: string;
  order: number;
}

export interface AssemblyWindowTypeDocDto {
  code: string;
  totalQty: number;
  hasAngles: boolean;
  angleCodes: string[];
  composition: string[];
  setLabels: string[];
  instructionPdfUrl: string | null;
  instructionPage: number | null;
  parts: AssemblyWindowPartsDto | null;
  glass?: GlassPanelDto[];
}

export interface AssemblyPartsCheckDto {
  checkedByUnit: Record<string, string[]>;
  highlightByUnit: Record<string, boolean>;
}

export interface ReworkDefectDto {
  id: string;
  cellCode: string;
  windowTypeCode: string | null;
  reason: string;
  createdAt: string;
}

export type AssemblyPipelineStatus = 'locked' | 'saw_only' | 'ready';

export interface AssemblyPipelineLineDto {
  id: string;
  instructionKind: string;
  description: string;
  quantity: number;
  sortOrder: number;
  imagePaths: string[];
  sawsProfileCode: string | null;
  planningCutLengthMm: number | null;
  sawnQty: number;
  cncDoneQty: number;
  status: AssemblyPipelineStatus;
}

export interface AssemblyWindowSpecDto {
  label: string;
  value: string;
}

export interface AssemblyWindowComponentDto {
  kind: string;
  line: string;
}

export interface AssemblyWindowUnitDto {
  id: string;
  displayLabel: string;
  quantity: number;
  assembledQty: number;
  imagePaths: string[];
  specs: AssemblyWindowSpecDto[];
  components: AssemblyWindowComponentDto[];
  assembled: boolean;
}

export interface AssemblyStationContextDto {
  pipeline: AssemblyPipelineLineDto[];
  windows: AssemblyWindowUnitDto[];
  pipelineReadyCount: number;
  pipelineTotalCount: number;
  windowsUnitCount: number;
  windowsTotalQty: number;
  windowsAssembledQty: number;
  typeReportByKind: Record<string, AssemblyTypeReportDto>;
  typesReportedCount: number;
  typesReportTarget: number;
}

export interface AssemblyTypeReportDto {
  reported: boolean;
  photoUrl: string | null;
}

export interface GluingUnitDto {
  productItemId: string;
  unitCode: string;
  quantity: number;
  displayLabel: string;
}

export interface GluingTypeGroupDto {
  instructionKind: string;
  typeNum: string | null;
  units: GluingUnitDto[];
  totalGlUnitQty: number;
  done: boolean;
  locked: boolean;
  cncDoneQty: number;
  cncTargetQty: number;
}

export interface GluingStationContextDto {
  groups: GluingTypeGroupDto[];
  typesWithGluing: number;
  typesDone: number;
  totalGlUnitQty: number;
  doneGlUnitQty: number;
}

export interface PackReportContext {
  requiredCount: number;
  photos: { slotIndex: number; url: string }[];
  complete: boolean;
}

export interface DeliveryNoteLineItemDto {
  lineKey: string;
  kind: string;
  profileCode: string | null;
  description: string;
  quantity: number;
  lengthMm: number | null;
  instructionKind: string | null;
  totalQuantity?: number;
  shippedQuantity?: number;
  remainingQuantity?: number;
}

export interface DeliveryNoteIssuedBrief {
  id: string;
  noteNumber: string;
  documentUrl: string;
  shippingType: 'INTERNAL' | 'EXTERNAL';
  externalPrice: string | null;
  issuedAt: string;
  status: 'ACTIVE' | 'CANCELLED';
  lineItemCount: number;
}

export interface DeliveryNoteContext {
  canIssue: boolean;
  hasActiveNote: boolean;
  allShipped: boolean;
  issuedCount: number;
  remainingItemCount: number;
  documentUrl: string | null;
  noteNumber: string | null;
  shippingType: 'INTERNAL' | 'EXTERNAL' | null;
  externalPrice: string | null;
  issuedAt: string | null;
  availableLineItems: DeliveryNoteLineItemDto[];
  issuedNotes: DeliveryNoteIssuedBrief[];
}

export interface AdminDeliveryNoteRow {
  id: string;
  projectId: string;
  projectName: string;
  noteNumber: string;
  shippingType: 'INTERNAL' | 'EXTERNAL';
  status: 'ACTIVE' | 'CANCELLED';
  externalPrice: string | null;
  documentUrl: string;
  issuedAt: string;
  cancelledAt: string | null;
  emailNotifiedAt: string | null;
  issuedByName: string | null;
  lineItemCount: number;
}

export interface ChartDataset {
  label?: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string | string[];
}

export interface AdminCharts {
  dailyProgress: {
    labels: string[];
    datasets: ChartDataset[];
  };
  stationLoad: {
    labels: string[];
    datasets: ChartDataset[];
  };
  /** Present only when not filtering by a single project */
  statusMix?: {
    labels: string[];
    datasets: ChartDataset[];
  };
}

export type ProjectDocumentKind =
  | 'PURCHASE_ORDER'
  | 'WORK_ORDER'
  | 'ELEVATION_MAP'
  | 'WINDOW_INSTRUCTION_PDF'
  | 'QUANTITIES_PDF'
  | 'ANGLE_INSTRUCTION_PDF';

/** אחד מ-4 קבצי ה-PDF של אשף פתיחת הפרויקט */
export type PlanningPdfKind =
  | 'ELEVATION_MAP'
  | 'WINDOW_INSTRUCTION_PDF'
  | 'QUANTITIES_PDF'
  | 'ANGLE_INSTRUCTION_PDF'
  | 'CONNECTION_DETAILS_PDF';

export interface WindowTypePreviewDto {
  id: string;
  code: string;
  totalQty: number;
  hasAngles: boolean;
  angleCodes: string[];
  composition: string[];
  setLabels: string[];
  instructionPdfUrl: string | null;
  instructionPage: number | null;
  connectionPdfUrl: string | null;
  facadeCount: number;
  elevationCellCount: number;
  parts: AssemblyWindowPartsDto | null;
}

export type FacadeDirection = 'SOUTH' | 'NORTH' | 'WEST' | 'EAST';

export interface FacadePreviewDto {
  id: string;
  label: string;
  groupKey: string;
  direction: FacadeDirection;
  totalQty: number;
  stageId: string | null;
  elevationPdfUrl: string | null;
}

/** קבוצת חזית (S / N5 / W2) — יחידת העלאת מפת החזיתות */
export interface FacadeGroupPreviewDto {
  key: string;
  direction: FacadeDirection;
  subLabels: string[];
  totalQty: number;
  elevationPdfUrl: string | null;
}

export interface StageFacadeDto {
  id: string;
  label: string;
  totalQty: number;
  elevationPdfUrl: string | null;
}

export interface StageFacadeGroupDto {
  direction: FacadeDirection;
  facades: StageFacadeDto[];
}

export interface StagePreviewDto {
  code: string;
  colorHex: string | null;
  totalQty: number;
  windowTypeCount: number;
  facadeCount: number;
  facadeTotalQty: number;
  facadeGroups: StageFacadeGroupDto[];
}

export interface AnglePreviewDto {
  code: string;
  qty: number;
  instructionPdfUrl: string | null;
  instructionPage: number | null;
}

export interface SteelworkDetailPreviewDto {
  id: string;
  title: string;
  targetQty: number;
  instructionPdfUrl: string | null;
}

/** תצוגה מקדימה לאשף 4 ה-PDF */
export interface PlanningPdfPreviewDto {
  projectId: string;
  angleSourcing: ProjectAngleSourcing;
  windowTypeCount: number;
  totalUnits: number;
  elevationCellCount: number;
  windowTypes: WindowTypePreviewDto[];
  stages: StagePreviewDto[];
  angles: AnglePreviewDto[];
  steelworkDetails: SteelworkDetailPreviewDto[];
  facades: FacadePreviewDto[];
  facadeCount: number;
  facadesWithElevation: number;
  facadeGroups: FacadeGroupPreviewDto[];
  facadeGroupCount: number;
  facadeGroupsWithElevation: number;
}

export interface PlanningPdfUploadResponse {
  ok: boolean;
  document: {
    id: string;
    kind: ProjectDocumentKind;
    title: string;
    pdfUrl: string;
    createdAt: string;
  };
  parse: Record<string, unknown>;
  preview: PlanningPdfPreviewDto;
}

export type ElevationCellKind = 'SPANDREL' | 'UNIT';
export type ElevationCellStatus = 'PENDING' | 'DONE';
export type ElevationMapStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface ElevationSectionDto {
  label: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ElevationPageDto {
  pageIndex: number;
  imageUrl: string;
  width: number;
  height: number;
  sections?: ElevationSectionDto[];
}

export interface ElevationCellDefectDto {
  returnedToStationId: number;
  reason: string;
}

export interface ElevationCellDto {
  id: string;
  pageIndex: number;
  code: string;
  floor: string | null;
  kind: ElevationCellKind;
  items: string[];
  bbox: { x: number; y: number; w: number; h: number };
  status: ElevationCellStatus;
  doneAt: string | null;
  doneBy: string | null;
  windowTypeCode?: string | null;
  windowTypeId?: string | null;
  defect?: ElevationCellDefectDto | null;
}

export interface ElevationProgressDto {
  total: number;
  done: number;
  pct: number;
  spandrel: { total: number; done: number };
  unit: { total: number; done: number };
  openDefects?: number;
}

export interface ElevationFacadeOptionDto {
  groupKey: string;
  label: string;
  direction: FacadeDirection;
  mapId: string;
  status: ElevationMapStatus;
  progress?: { total: number; done: number; pct: number };
}

export interface ElevationMapResponse {
  map: {
    id: string;
    title: string;
    status: ElevationMapStatus;
    pageCount: number;
    pages: ElevationPageDto[];
    error: string | null;
  } | null;
  /** קבוצות החזיתות עם מפה (בורר בתצוגת ההתקנה); ריק לפרויקטים ישנים */
  facades?: ElevationFacadeOptionDto[];
  selectedFacadeGroup?: string | null;
  cells?: ElevationCellDto[];
  windowTypeCodes?: string[];
  progress?: ElevationProgressDto;
}

export interface ProjectDocumentDto {
  id: string;
  kind: ProjectDocumentKind;
  title: string;
  reference: string | null;
  pdfUrl: string;
  /** ISO — תאריך העלאה / יצירת הרשומה */
  createdAt: string;
}

export interface SendProjectDocumentEmailResponse {
  sent: boolean;
  mode: 'smtp' | 'mailto';
  mailto?: string;
}

export interface ProjectOpenedByUser {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  role: SkyflowRole;
}

export interface AdminProjectRow {
  id: string;
  name: string;
  status: OrderStatus;
  flowStatus: ProjectFlowStatus;
  lineMaterial?: ProjectLineMaterial;
  machiningRoute?: ProjectMachiningRoute;
  totalItems: number;
  packed: number;
  progressPct: number;
  workOrders: ProjectDocumentDto[];
  purchaseOrders: ProjectDocumentDto[];
  /** תצוגה חיה — פרויקט בביצוע עם דיווח בתחנה 1 */
  liveViewAvailable?: boolean;
  /** משתמש שיצר/פתח את הפרויקט */
  openedBy?: ProjectOpenedByUser | null;
}

export type ProductType = 'UNIT' | 'WINDOW';

/** תמונה מוטמעת בקובץ Excel (ייצוא מ־xlsx) */
export interface PlanningPreviewImageDto {
  /** כתובת יחסית לשרת (דרך proxy: `/api/planning-imports/{projectId}/…`) */
  url: string;
  /** שורה בגליון (0-based כמו OOXML); להצגה למשתמש משתמשים ב־+1 */
  anchorRow: number;
  anchorCol: number;
  pictureName?: string;
}

/** כרטיס רכיב בתצוגה מקדימה — טקסט + תמונה משויכת */
export interface PlanningPreviewComponentCardDto {
  label: string;
  image?: PlanningPreviewImageDto;
}

/** שורה בתצוגת פירוט תכנון (יחידה / חלון) */
export interface PlanningPreviewLineDto {
  /** תווית ללא קידומת שם הגליון */
  displayLabel: string;
  instructionKind: string;
  productType: ProductType;
  componentCount: number;
  /** כרטיסי רכיב (טקסט + תמונה) */
  componentCards?: PlanningPreviewComponentCardDto[];
  /** @deprecated — השתמשו ב־componentCards */
  componentLines?: string[];
  /** תמונות שלא שויכו לרכיב ספציפי */
  images?: PlanningPreviewImageDto[];
}

/** טאב גליון (TYPE 2, Window Instruction, …) */
export interface PlanningPreviewSheetTabDto {
  sheetName: string;
  unitCount: number;
  windowCount: number;
  itemCount: number;
  rows: PlanningPreviewLineDto[];
  /** תמונות שלא שויכו לשורת יחידה (כותרת גליון וכו׳) */
  images?: PlanningPreviewImageDto[];
}

/** סיכום קובץ תפ״י אחרי פרסור */
export interface PlanningParsePreviewDto {
  projectId: string;
  totalUnits: number;
  totalWindows: number;
  totalComponents: number;
  itemCount: number;
  /** פירוט לפי גליונות ה־Excel (כותרת מ `[שם גליון]` בשדה label) */
  sheets?: PlanningPreviewSheetTabDto[];
}

/** פרויקטים במצב תכנון (רשימה לבורר בעמוד תפ״י) */
export interface PlanningDraftListItemDto {
  id: string;
  name: string;
  flowStatus: ProjectFlowStatus;
  updatedAt: string;
  createdAt: string;
  requirements: string;
  lineMaterial: ProjectLineMaterial;
  machiningRoute: ProjectMachiningRoute;
  angleSourcing?: ProjectAngleSourcing;
  projectManagerUserId?: string | null;
  itemCount: number;
  windowTypeCount?: number;
  wizardStep: 2 | 3;
  progressPct: number;
}

export type PlanningWizardPanelMode =
  | 'default'
  | 'uploadPreview'
  | 'summaryApprove';

export interface Bottleneck {
  stationId: number;
  name: string;
  severity: number;
  detail: string;
}

export interface AdminDashboardSummary {
  totalOrders: number;
  activeOrders: number;
  stationLogEntries: number;
  scrapUnits: number;
  processedVolume: number;
  scrapRatePct: number | null;
  lastActivityAt: string | null;
  scope: 'all' | 'project';
}

export interface AdminSelectedProject {
  id: string;
  name: string;
}

export interface AdminDashboard {
  summary: AdminDashboardSummary;
  /** Set when `projectId` query matched a project */
  selectedProject: AdminSelectedProject | null;
  projects: AdminProjectRow[];
  bottlenecks: Bottleneck[];
  charts: AdminCharts;
}

export interface ShippingRow {
  projectId: string;
  name: string;
  totalItems: number;
  packedQty: number;
  ready: boolean;
}

export interface ShippingResponse {
  rows: ShippingRow[];
}

export type SkyflowRole =
  | 'WORKER'
  | 'ADMIN'
  | 'PLANNING'
  | 'STATION_MANAGER'
  | 'SITE_MANAGER';

/** משתמש לבחירת שיבוץ בעמוד תפ״י (עובד / מנהל מסורים) */
export interface PlanningAssigneeOptionDto {
  id: string;
  firstName: string;
  lastName: string;
  role: SkyflowRole;
  managedStationId: number | null;
  photoUrl: string | null;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: SkyflowRole;
  photoUrl: string | null;
  managedStationId: number | null;
}

export interface UserPerformanceSummary {
  totalReports: number;
  totalProcessedQty: number;
  projectsTouched: number;
  activeDays: number;
  estimatedActiveHours: number;
  todayReports: number;
  yesterdayReports: number;
  todayProcessedQty: number;
  yesterdayProcessedQty: number;
  avgReportsPerActiveDay: number;
  weeklyReports: number;
  paceVsPlantPct: number | null;
  lastActivityAt: string | null;
  firstActivityAt: string | null;
}

export interface UserPerformanceStationRow {
  stationId: number;
  reports: number;
  processedQty: number;
}

export interface UserPerformanceDayRow {
  date: string;
  reports: number;
  processedQty: number;
  estimatedHours: number;
}

export interface UserPerformanceActivityRow {
  id: string;
  createdAt: string;
  stationId: number;
  projectId: string;
  projectName: string;
  processedQty: number;
  issues: string | null;
}

export interface UserPerformanceResponse {
  user: UserDto;
  summary: UserPerformanceSummary;
  byStation: UserPerformanceStationRow[];
  dailyActivity: UserPerformanceDayRow[];
  recentActivity: UserPerformanceActivityRow[];
}

export interface UserDailyTargetDayRow {
  date: string;
  description: string | null;
  targetMinutes: number | null;
  targetQty: number | null;
  actualMinutes: number;
  actualQty: number;
  achievementPct: number | null;
  reports: number;
  processedQty: number;
  hasTarget: boolean;
  items: UserDailyTargetItemRow[];
}

export interface UserDailyTargetItemRow {
  id: string;
  source: 'MANUAL' | 'PLANNING';
  description: string;
  targetMinutes: number;
  targetQty: number | null;
  actualQty: number;
  achievementPct: number | null;
  projectId: string | null;
  projectName: string | null;
  stationId: number | null;
  stationName: string | null;
  lineItems: UserDailyTargetLineItemRow[];
}

export interface UserDailyTargetLineItemRow {
  sortOrder: number;
  description: string;
  profileCode: string | null;
  cutLengthMm: number | null;
  instructionKind: string;
  targetQty: number;
}

export interface UserDailyTargetsResponse {
  user: UserDto;
  todayKey: string;
  today: UserDailyTargetDayRow | null;
  history: UserDailyTargetDayRow[];
}

export type UserDailyTargetAlertLevel = 'warning' | 'missed';

export interface UserDailyTargetAlertRow {
  userId: string;
  firstName: string;
  lastName: string;
  description: string;
  targetMinutes: number;
  actualMinutes: number;
  achievementPct: number;
  level: UserDailyTargetAlertLevel;
}

export interface UserDailyTargetAlertsResponse {
  todayKey: string;
  alerts: UserDailyTargetAlertRow[];
}

export interface ScrapOverviewRow {
  id: string;
  projectId: string;
  projectName: string;
  stationId: number;
  stationName: string;
  itemLengthMm: number;
  scrapQty: number;
  profileKind: string;
  profileCode: string;
  createdAt: string;
}

export interface ScrapOverviewResponse {
  rows: ScrapOverviewRow[];
}

export interface ProfileInventoryRow {
  profileKind: 'CATALOG' | 'DRAWN';
  profileCode: string;
  lengthMm: number;
  qty: number;
  totalMm: number;
}

export interface SimulationProjectRow {
  projectId: string;
  name: string;
  needMm: number;
  scrapMm: number;
  gapMm: number;
  /** אורך ייחוס מההזמנה (BOM) — לברירת מחדל בסימולציה */
  originalLengthMm: number;
  totalItems: number;
  profileInventory: ProfileInventoryRow[];
}

export interface SimulationSnapshotResponse {
  catalogProfileCodes: string[];
  projects: SimulationProjectRow[];
}

export interface SimProfileNeedLine {
  profileKind: 'CATALOG' | 'DRAWN';
  profileCode: string;
  qty: number;
  lengthMm: number;
}

/** סימולציית הזמנה — לפי פרופילים ופחת מפרויקט מקור */
export interface OrderSimulationRecord {
  id: string;
  title: string;
  createdAt: string;
  scrapSourceProjectId: string;
  scrapSourceProjectName: string;
  needLines: SimProfileNeedLine[];
  inventoryAtSave: ProfileInventoryRow[];
  totalNeedMm: number;
  totalCoveredMm: number;
  totalGapMm: number;
}

export interface ProjectActivityStation {
  stationId: number;
  stationName: string;
  logEntries: number;
  processedQty: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
  scrapQty: number;
  scrapEntries: number;
  lastScrapAt: string | null;
}

export interface ProjectActivityLog {
  id: string;
  stationId: number;
  processedQty: number;
  createdAt: string;
  issues: string | null;
}

export interface ProjectActivityScrapRow {
  id: string;
  stationId: number;
  stationName: string;
  scrapQty: number;
  itemLengthMm: number;
  createdAt: string;
}

export interface ProjectActivityResponse {
  project: {
    id: string;
    name: string;
    status: OrderStatus;
    flowStatus: ProjectFlowStatus;
    totalItems: number;
    createdAt: string;
    updatedAt: string;
    documentCount: number;
  };
  totals: {
    processedQty: number;
    scrapUnits: number;
    stationLogEntries: number;
  };
  stations: ProjectActivityStation[];
  recentLogs: ProjectActivityLog[];
  scrapRows: ProjectActivityScrapRow[];
}

export interface StationManagersResponse {
  [stationId: number]: {
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  };
}

export type WorkCycleStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'RETURNED';

export type WorkCycleStationStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE';

export interface WorkCycleStationProgress {
  id: string;
  stationId: number;
  targetQty: number;
  processedQty: number;
  status: WorkCycleStationStatus;
}

export interface WorkCycleAssignmentUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface WorkCycleAssignment {
  id: string;
  userId: string;
  role: 'MANAGER' | 'WORKER';
  stationId: number | null;
  sortOrder: number;
  user: WorkCycleAssignmentUser;
}

export interface WorkCycle {
  id: string;
  projectId: string;
  windowTypeId: string;
  status: WorkCycleStatus;
  targetQty: number;
  dailyTargetQty: number | null;
  dailyTargetHours: number | null;
  currentStationId: number | null;
  openedAt: string | null;
  completedAt: string | null;
  returnedAt: string | null;
  returnedFromStationId: number | null;
  returnReason: string | null;
  windowType: {
    id: string;
    code: string;
    totalQty: number;
    hasAngles: boolean;
    instructionDocId: string | null;
  };
  stationProgress: WorkCycleStationProgress[];
  assignments: WorkCycleAssignment[];
}

export interface WorkCycleAssignmentInput {
  userId: string;
  role: 'MANAGER' | 'WORKER';
  stationId?: number | null;
}

/** פעימת דיווח של תחנה בפרטי היחידה (מי דיווח, כמה, מתי). */
export interface WorkCycleLogDto {
  id: string;
  stationId: number;
  processedQty: number;
  cutLength: number | null;
  createdAt: string;
  worker: { id: string; firstName: string; lastName: string } | null;
}

/** נתוני היחידה שמופו מה-PDF — לצפייה/עריכה מכרטיס היחידה בשלב 3. */
export interface WorkCycleWindowDataDto {
  id: string;
  code: string;
  totalQty: number;
  hasAngles: boolean;
  composition: string[];
  angleCodes: string[];
  parts: AssemblyWindowPartsDto | null;
  instructionPage: number | null;
  instructionPdfUrl: string | null;
  instructionTitle: string | null;
  connectionPdfUrl: string | null;
}

/** תשובת פרטי היחידה: נתונים ממופים + מסע התחנות (התקדמות + יומן). */
export interface WorkCycleDetailsDto {
  cycle: {
    id: string;
    projectId: string;
    windowTypeId: string;
    status: WorkCycleStatus;
    targetQty: number;
    currentStationId: number | null;
    openedAt: string | null;
    completedAt: string | null;
    returnedAt: string | null;
    returnedFromStationId: number | null;
    returnReason: string | null;
  };
  windowType: WorkCycleWindowDataDto;
  stationProgress: WorkCycleStationProgress[];
  assignments: WorkCycleAssignment[];
  logs: WorkCycleLogDto[];
}

/** גוף בקשת עריכת נתוני יחידה — רק הקבוצות שנגעו בהן נשלחות. */
export interface EditWorkCycleWindowBody {
  totalQty?: number;
  composition?: string[];
  hasAngles?: boolean;
  angleCodes?: string[];
  sections?: AssemblyWindowPartSection[];
  fullReroute?: boolean;
}

export interface StationWorkCycleRow {
  cycleId: string;
  windowTypeId: string;
  code: string;
  /** Public path to WINDOW_INSTRUCTION_PDF when uploaded. */
  instructionPdfUrl?: string | null;
  /** Document title from the uploaded production instructions. */
  instructionTitle?: string | null;
  status: WorkCycleStatus;
  currentStationId: number | null;
  targetQty: number;
  processedQty: number;
  remaining: number;
  stationStatus: WorkCycleStationStatus;
}

export interface WorkerCycleStation {
  stationId: number;
  targetQty: number;
  processedQty: number;
  remaining: number;
  status: WorkCycleStationStatus;
}

/** A project unit (work cycle) as shown on the worker hub unit picker. */
export interface WorkerProjectCycle {
  cycleId: string;
  windowTypeId: string;
  code: string;
  status: WorkCycleStatus;
  currentStationId: number | null;
  targetQty: number;
  stations: WorkerCycleStation[];
}

/* ===== מעקב ובקרה מודולים — עמוד מנהל הפרויקט (תחנת הרכבה באתר) ===== */

export type TrackingPhase = 'PRODUCTION' | 'SUPPLY' | 'INSTALL';
export type TrackingPhaseStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';

/** פעימת דיווח בודדת — תאריך + כמות (+ תעודה לאספקה). */
export interface TrackingBeatDto {
  id: string;
  phase: TrackingPhase;
  occurredOn: string;
  qty: number;
  note: string | null;
  deliveryNoteId: string | null;
  deliveryNoteNumber: string | null;
  createdAt: string;
}

/** מצב שלב (ייצור / אספקה / התקנה) בשורת מעקב. */
export interface TrackingPhaseState {
  qty: number;
  remaining: number;
  status: TrackingPhaseStatus;
}

/** שורת מעקב = מודול בודד (חזית × קוד מודול). */
export interface TrackingRowDto {
  id: string;
  stageCode: string;
  facadeLabel: string;
  facadeGroup: string;
  floor: string | null;
  moduleCode: string;
  windowTypeId: string | null;
  plannedQty: number;
  notes: string;
  sortOrder: number;
  production: TrackingPhaseState;
  supply: TrackingPhaseState;
  install: TrackingPhaseState;
  beats: TrackingBeatDto[];
}

export interface TrackingSummaryDto {
  plannedQty: number;
  producedQty: number;
  suppliedQty: number;
  installedQty: number;
  remainingProduction: number;
  remainingSupply: number;
  remainingInstall: number;
  producedPct: number;
  suppliedPct: number;
  installedPct: number;
}

export interface TrackingStageSummaryDto {
  code: string;
  facadeCount: number;
  moduleCount: number;
  plannedQty: number;
}

export interface TrackingDeliveryNoteDto {
  id: string;
  noteNumber: string;
  shippingType: 'INTERNAL' | 'EXTERNAL';
  status: 'ACTIVE' | 'CANCELLED';
  active: boolean;
  documentUrl: string;
  externalPrice: string | null;
  issuedAt: string;
  issuedByName: string | null;
}

export interface TrackingResponse {
  project: { id: string; name: string };
  summary: TrackingSummaryDto;
  stageSummary: TrackingStageSummaryDto[];
  filters: { stages: string[]; facadeLabels: string[]; moduleCodes: string[] };
  deliveryNotes: TrackingDeliveryNoteDto[];
  rows: TrackingRowDto[];
}

/** גוף בקשה להוספת פעימת דיווח. */
export interface AddTrackingBeatBody {
  phase: TrackingPhase;
  occurredOn: string;
  qty: number;
  deliveryNoteId?: string | null;
  note?: string | null;
}

/* ===== מערכת התראות ===== */

/** סוג אירוע התראה — קובע אייקון + תבנית טקסט. */
export type NotificationKind =
  | 'CYCLE_LAUNCHED'
  | 'CYCLE_REPORTED'
  | 'CYCLE_COMPLETED'
  | 'CYCLE_RETURNED'
  | 'STATION_LOG'
  | 'DAILY_TARGET_MANUAL'
  | 'DELIVERY_NOTE_ISSUED'
  | 'ELEVATION_CELL_DONE'
  | 'ELEVATION_DEFECT'
  | 'PLANNING_APPROVED'
  | 'PROJECT_COMPLETED'
  | 'TRACKING_BEAT';

/** התראה בודדת עבור המשתמש הנוכחי. */
export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  titleKey: string;
  bodyKey: string | null;
  params: Record<string, unknown> | null;
  link: string | null;
  projectId: string | null;
  projectName: string | null;
  stationId: number | null;
  actorName: string | null;
  read: boolean;
  createdAt: string;
}

/** תשובת רשימת ההתראות + ספירת הלא-נקראו. */
export interface NotificationListResponse {
  items: NotificationDto[];
  unreadCount: number;
}
