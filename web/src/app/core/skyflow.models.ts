export type ProjectFlowStatus =
  | 'PENDING_PLANNING'
  | 'IN_PRODUCTION'
  | 'COMPLETED';

export type OrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD';

export type ProjectLineMaterial = 'ALUMINUM' | 'STEEL';
export type ProjectMachiningRoute = 'GLASS' | 'ALU_RANGER';

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
  itemCount: number;
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
