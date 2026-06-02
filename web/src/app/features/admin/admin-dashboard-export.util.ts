import * as XLSX from 'xlsx';

import heTranslations from '../../../assets/i18n/he.json';
import {
  AdminDashboard,
  AdminProjectRow,
  ProjectDocumentDto,
  ShippingResponse,
} from '../../core/skyflow.models';

export type DashboardExportTr = (key: string) => string;

export function resolveExportTr(
  bundle: Record<string, unknown>,
  key: string,
): string {
  const parts = key.split('.');
  let cur: unknown = bundle;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return key;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : key;
}

export function hebrewDashboardExportTr(key: string): string {
  return resolveExportTr(heTranslations as Record<string, unknown>, key);
}

function clipSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
  return cleaned.slice(0, 31) || 'Sheet1';
}

export function safeDashboardExportFileSegment(name: string): string {
  const t = name.replace(/[/:*?"<>|\\]/g, '_').trim();
  return (t || 'project').slice(0, 48);
}

function formatHeDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatHeDay(iso: string): string {
  const dt = new Date(`${iso}T12:00:00Z`);
  return dt.toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDocs(docs: ProjectDocumentDto[]): string {
  if (!docs.length) return '—';
  return docs
    .map((d) => (d.reference ? `${d.title} (${d.reference})` : d.title))
    .join(' | ');
}

function orderStatusLabel(status: string, tr: DashboardExportTr): string {
  return tr(`ORDER_STATUS.${status}`);
}

function flowStatusLabel(flow: string, tr: DashboardExportTr): string {
  return tr(`PROJECT_FLOW.${flow}`);
}

function lineMaterialLabel(
  material: AdminProjectRow['lineMaterial'],
  tr: DashboardExportTr,
): string {
  if (!material) return '—';
  return tr(`PLANNING.LINE_MATERIAL_${material}`);
}

function machiningRouteLabel(
  route: AdminProjectRow['machiningRoute'],
  tr: DashboardExportTr,
): string {
  if (!route) return '—';
  return tr(`PLANNING.MACHINING_ROUTE_${route}`);
}

function openedByLabel(project: AdminProjectRow): string {
  const u = project.openedBy;
  if (!u) return '—';
  return `${u.firstName} ${u.lastName}`.trim() || '—';
}

function buildSummarySheet(
  d: AdminDashboard,
  shipping: ShippingResponse | null,
  filterLabel: string,
  tr: DashboardExportTr,
): (string | number)[][] {
  const liveCount = d.projects.filter((p) => p.liveViewAvailable).length;
  const shippingRows = shipping?.rows ?? [];
  const shippingPacked = shippingRows.reduce((sum, r) => sum + r.packedQty, 0);
  const shippingTotal = shippingRows.reduce((sum, r) => sum + r.totalItems, 0);

  return [
    [tr('ADMIN_PAGE.EXPORT_METRIC'), tr('ADMIN_PAGE.EXPORT_VALUE')],
    [tr('ADMIN_PAGE.EXPORT_GENERATED_AT'), formatHeDateTime(new Date().toISOString())],
    [tr('ADMIN_PAGE.FILTER_PROJECT'), filterLabel],
    [
      tr('ADMIN_PAGE.EXPORT_SCOPE'),
      d.summary.scope === 'project'
        ? tr('ADMIN_PAGE.EXPORT_SCOPE_SINGLE')
        : tr('ADMIN_PAGE.EXPORT_SCOPE_ALL'),
    ],
    [],
    [tr('ADMIN_PAGE.ACTIVE_PROJECTS'), d.summary.activeOrders],
    [tr('ADMIN_PAGE.TOTAL_ORDERS'), d.summary.totalOrders],
    [tr('ADMIN_PAGE.PROCESSED_VOLUME'), d.summary.processedVolume],
    [tr('ADMIN_PAGE.LOG_ENTRIES'), d.summary.stationLogEntries],
    [tr('ADMIN_PAGE.SCRAP_UNITS'), d.summary.scrapUnits],
    [
      tr('ADMIN_PAGE.SCRAP_RATE'),
      d.summary.scrapRatePct != null ? `${d.summary.scrapRatePct}%` : '—',
    ],
    [tr('ADMIN_PAGE.LAST_ACTIVITY'), formatHeDateTime(d.summary.lastActivityAt)],
    [tr('ADMIN_PAGE.EXPORT_PROJECTS_COUNT'), d.projects.length],
    [tr('ADMIN_PAGE.EXPORT_LIVE_PROJECTS_COUNT'), liveCount],
    [tr('ADMIN_PAGE.EXPORT_SHIPPING_PROJECTS'), shippingRows.length],
    [
      tr('ADMIN_PAGE.EXPORT_SHIPPING_PACKED'),
      shippingRows.length ? `${shippingPacked} / ${shippingTotal}` : '—',
    ],
  ];
}

function buildProjectsSheet(
  projects: AdminProjectRow[],
  tr: DashboardExportTr,
): (string | number)[][] {
  return [
    [
      tr('ADMIN_PAGE.EXPORT_COL_PROJECT'),
      tr('ADMIN_PAGE.STATUS_COL'),
      tr('ADMIN_PAGE.EXPORT_COL_FLOW'),
      tr('ADMIN_PAGE.EXPORT_COL_LINE_MATERIAL'),
      tr('ADMIN_PAGE.EXPORT_COL_MACHINING_ROUTE'),
      tr('ADMIN_PAGE.PROGRESS'),
      tr('ADMIN_PAGE.PACKED'),
      tr('ADMIN_PAGE.EXPORT_COL_TOTAL_ITEMS'),
      tr('ADMIN_PAGE.EXPORT_COL_LIVE'),
      tr('ADMIN_PAGE.EXPORT_COL_WO_COUNT'),
      tr('ADMIN_PAGE.EXPORT_COL_WORK_ORDERS'),
      tr('ADMIN_PAGE.EXPORT_COL_PO_COUNT'),
      tr('ADMIN_PAGE.EXPORT_COL_PURCHASE_ORDERS'),
      tr('ADMIN_PAGE.EXPORT_COL_OPENED_BY'),
    ],
    ...projects.map((p) => [
      p.name,
      orderStatusLabel(p.status, tr),
      flowStatusLabel(p.flowStatus, tr),
      lineMaterialLabel(p.lineMaterial, tr),
      machiningRouteLabel(p.machiningRoute, tr),
      p.progressPct,
      `${p.packed} / ${p.totalItems}`,
      p.totalItems,
      p.liveViewAvailable ? tr('ADMIN_PAGE.EXPORT_YES') : tr('ADMIN_PAGE.EXPORT_NO'),
      p.workOrders.length,
      formatDocs(p.workOrders),
      p.purchaseOrders.length,
      formatDocs(p.purchaseOrders),
      openedByLabel(p),
    ]),
  ];
}

function buildDailyProgressSheet(
  d: AdminDashboard,
  tr: DashboardExportTr,
): (string | number)[][] {
  const chart = d.charts.dailyProgress;
  const dataset = chart.datasets[0];
  const valueHeader =
    typeof dataset?.label === 'string' && dataset.label.trim()
      ? dataset.label
      : tr('ADMIN_PAGE.EXPORT_DATASET_UNITS');

  return [
    [tr('ADMIN_PAGE.EXPORT_COL_DATE'), valueHeader],
    ...chart.labels.map((iso, i) => [
      formatHeDay(iso),
      Number((dataset?.data as number[] | undefined)?.[i] ?? 0),
    ]),
  ];
}

function buildStationLoadSheet(d: AdminDashboard): (string | number)[][] {
  const chart = d.charts.stationLoad;
  const dataset = chart.datasets[0];
  const valueHeader =
    typeof dataset?.label === 'string' && dataset.label.trim()
      ? dataset.label
      : 'יחידות מעובדות (מצטבר)';

  return [
    ['עמדה', valueHeader],
    ...chart.labels.map((label, i) => [
      label,
      Number((dataset?.data as number[] | undefined)?.[i] ?? 0),
    ]),
  ];
}

function buildStatusMixSheet(
  d: AdminDashboard,
  tr: DashboardExportTr,
): (string | number)[][] | null {
  const mix = d.charts.statusMix;
  if (!mix?.labels?.length) return null;

  const data = (mix.datasets[0]?.data as number[] | undefined) ?? [];
  const total = data.reduce((sum, v) => sum + (Number(v) || 0), 0);

  return [
    [
      tr('ADMIN_PAGE.STATUS_COL'),
      tr('ADMIN_PAGE.EXPORT_COL_QUANTITY'),
      tr('ADMIN_PAGE.EXPORT_COL_PERCENT'),
    ],
    ...mix.labels.map((status, i) => {
      const qty = Number(data[i] ?? 0);
      const pct = total > 0 ? Math.round((qty / total) * 1000) / 10 : 0;
      return [orderStatusLabel(status, tr), qty, `${pct}%`];
    }),
  ];
}

function buildBottlenecksSheet(
  d: AdminDashboard,
  tr: DashboardExportTr,
): (string | number)[][] {
  return [
    [
      tr('ADMIN_PAGE.EXPORT_COL_STATION'),
      tr('ADMIN_PAGE.SEVERITY'),
      tr('ADMIN_PAGE.EXPORT_COL_DETAIL'),
    ],
    ...(d.bottlenecks.length
      ? d.bottlenecks.map((b) => [b.name, b.severity, b.detail])
      : [[tr('ADMIN_PAGE.EXPORT_NO_BOTTLENECKS'), '—', '—']]),
  ];
}

function buildShippingSheet(
  shipping: ShippingResponse | null,
  tr: DashboardExportTr,
): (string | number)[][] {
  const rows = shipping?.rows ?? [];
  return [
    [
      tr('ADMIN_PAGE.EXPORT_COL_PROJECT'),
      tr('ADMIN_PAGE.EXPORT_COL_TOTAL_ITEMS'),
      tr('ADMIN_PAGE.EXPORT_COL_PACKED_QTY'),
      tr('ADMIN_PAGE.EXPORT_COL_READY'),
    ],
    ...(rows.length
      ? rows.map((r) => [
          r.name,
          r.totalItems,
          r.packedQty,
          r.ready ? tr('ADMIN_PAGE.EXPORT_YES') : tr('ADMIN_PAGE.EXPORT_NO'),
        ])
      : [[tr('ADMIN_PAGE.NO_SHIPPING'), '—', '—', '—']]),
  ];
}

export function buildAdminDashboardWorkbook(
  d: AdminDashboard,
  shipping: ShippingResponse | null,
  filterLabel: string,
  tr: DashboardExportTr,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildSummarySheet(d, shipping, filterLabel, tr)),
    clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_SUMMARY')),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildProjectsSheet(d.projects, tr)),
    clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_PROJECTS')),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildDailyProgressSheet(d, tr)),
    clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_DAILY')),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildStationLoadSheet(d)),
    clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_STATIONS')),
  );

  const statusSheet = buildStatusMixSheet(d, tr);
  if (statusSheet) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(statusSheet),
      clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_STATUS')),
    );
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildBottlenecksSheet(d, tr)),
    clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_BOTTLENECKS')),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildShippingSheet(shipping, tr)),
    clipSheetName(tr('ADMIN_PAGE.EXPORT_SHEET_SHIPPING')),
  );

  return wb;
}

export function dashboardExportFileName(
  d: AdminDashboard,
  filterLabel: string,
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const segment =
    d.summary.scope === 'project'
      ? safeDashboardExportFileSegment(filterLabel)
      : 'all-projects';
  return `skyflow-dashboard-${segment}-${stamp}.xlsx`;
}
