export type OrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD';

export interface ProjectOrder {
  id: string;
  name: string;
  totalItems: number;
  requirements: string;
  status: OrderStatus;
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
  totalItems: number;
  packed: number;
  progressPct: number;
  workOrders: ProjectDocumentDto[];
  purchaseOrders: ProjectDocumentDto[];
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
