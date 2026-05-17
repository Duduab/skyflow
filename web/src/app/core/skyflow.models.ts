export type ProjectFlowStatus =
  | 'PENDING_PLANNING'
  | 'IN_PRODUCTION'
  | 'COMPLETED';

export type OrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD';

export interface ProjectOrder {
  id: string;
  name: string;
  totalItems: number;
  requirements: string;
  status: OrderStatus;
  flowStatus: ProjectFlowStatus;
  originalLength: string | number;
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
  /** אורך חיתוך מהתכנון (ס״מ) — מתא Excel; מקור למטרים לניסור */
  planningCutLengthCm?: number | null;
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
  sawWorkMetersByLineId?: Record<string, number>;
  /**
   * Stations 2–4 — כמה דווחו לפי מזהה שורת תכנון (מודאל TYPE, ללא מטרים).
   */
  workLineDoneByLineId?: Record<string, number>;
  /** Station 1 — עובדי מסורים משובצים מתכנון (מרובים) */
  planningSawsTeam?: WorkerStationManagerDisplayDto[];
  /** Station 7 — הרכבה באתר */
  siteAssembly?: SiteAssemblyContext | null;
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

export type ProjectDocumentKind = 'PURCHASE_ORDER' | 'WORK_ORDER';

export interface ProjectDocumentDto {
  id: string;
  kind: ProjectDocumentKind;
  title: string;
  reference: string | null;
  pdfUrl: string;
  /** ISO — תאריך העלאה / יצירת הרשומה */
  createdAt: string;
}

export interface AdminProjectRow {
  id: string;
  name: string;
  status: OrderStatus;
  flowStatus: ProjectFlowStatus;
  totalItems: number;
  packed: number;
  progressPct: number;
  workOrders: ProjectDocumentDto[];
  purchaseOrders: ProjectDocumentDto[];
  /** תצוגה חיה — פרויקט בביצוע עם דיווח בתחנה 1 */
  liveViewAvailable?: boolean;
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

/** שורה בתצוגת פירוט תכנון (יחידה / חלון) */
export interface PlanningPreviewLineDto {
  /** תווית ללא קידומת שם הגליון */
  displayLabel: string;
  instructionKind: string;
  productType: ProductType;
  componentCount: number;
  /** דגימת שורות רכיב לתצוגה */
  componentLines: string[];
  /** תמונות מהגליון ששויכו ליחידה/שורה זו */
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

export interface ScrapOverviewRow {
  id: string;
  projectId: string;
  projectName: string;
  stationId: number;
  stationName: string;
  itemLengthCm: number;
  scrapQty: number;
  createdAt: string;
}

export interface ScrapOverviewResponse {
  rows: ScrapOverviewRow[];
}

export interface SimulationProjectRow {
  projectId: string;
  name: string;
  needCm: number;
  scrapCm: number;
  gapCm: number;
  /** אורך ייחוס מההזמנה (BOM) — לברירת מחדל בסימולציה */
  originalLengthCm: number;
  totalItems: number;
}

export interface SimulationSnapshotResponse {
  projects: SimulationProjectRow[];
}

/** סימולציית הזמנה שמורה מקומית (רשימה בעמוד הסימולציה) */
export interface OrderSimulationRecord {
  id: string;
  title: string;
  createdAt: string;
  projectId: string;
  projectName: string;
  beamsQty: number;
  glazingQty: number;
  unitizedQty: number;
  cmPerBeam: number;
  cmPerGlazing: number;
  cmPerUnitized: number;
  baseNeedCm: number;
  scrapCmAtSave: number;
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
  itemLengthCm: number;
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
