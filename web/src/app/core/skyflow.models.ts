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
  /** Station 1 — קווי עבודה למסורים אחרי אישור תכנון */
  sawWorkLines?: SawWorkLineDto[];
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

/** שורה בתצוגת פירוט תכנון (יחידה / חלון) */
export interface PlanningPreviewLineDto {
  /** תווית ללא קידומת שם הגליון */
  displayLabel: string;
  instructionKind: string;
  productType: ProductType;
  componentCount: number;
  /** דגימת שורות רכיב לתצוגה */
  componentLines: string[];
}

/** טאב גליון (TYPE 2, Window Instruction, …) */
export interface PlanningPreviewSheetTabDto {
  sheetName: string;
  unitCount: number;
  windowCount: number;
  itemCount: number;
  rows: PlanningPreviewLineDto[];
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
  | 'STATION_MANAGER'
  | 'SITE_MANAGER';

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
