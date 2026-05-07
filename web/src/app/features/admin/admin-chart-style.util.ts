import type { ChartDataset, ScriptableContext } from 'chart.js';
import { ArcElement, BarElement } from 'chart.js';

/** מבהיק / מכהה RGBA פשוט לגרדיאנט "תלת־ממדי" */
function shadeRgbaChannel(rgba: string, lighten: boolean): string {
  const m = rgba.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/,
  );
  if (!m) return rgba;
  let r = Number(m[1]);
  let g = Number(m[2]);
  let b = Number(m[3]);
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  const f = lighten ? 1.22 : 0.72;
  r = Math.min(255, Math.round(r * f));
  g = Math.min(255, Math.round(g * f));
  b = Math.min(255, Math.round(b * f));
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, a + (lighten ? 0.06 : -0.08))})`;
}

export function enhanceAdminLineDataset(
  ds: ChartDataset<'line', number[]>,
): ChartDataset<'line', number[]> {
  const border =
    typeof ds.borderColor === 'string'
      ? ds.borderColor
      : 'rgba(56, 189, 248, 1)';

  return {
    ...ds,
    tension: 0.42,
    fill: true,
    borderWidth: 3,
    borderJoinStyle: 'round',
    borderCapStyle: 'round',
    pointRadius: 5,
    pointHoverRadius: 11,
    pointBackgroundColor: '#f8fafc',
    pointBorderWidth: 2,
    pointBorderColor: border,
    borderColor: border,
    backgroundColor: (context: ScriptableContext<'line'>) => {
      const chart = context.chart;
      const { ctx, chartArea } = chart;
      if (!chartArea) return 'rgba(56, 189, 248, 0.22)';
      const g = ctx.createLinearGradient(
        0,
        chartArea.bottom,
        0,
        chartArea.top,
      );
      g.addColorStop(0, 'rgba(15, 23, 42, 0)');
      g.addColorStop(0.28, 'rgba(56, 189, 248, 0.12)');
      g.addColorStop(0.65, 'rgba(125, 211, 252, 0.38)');
      g.addColorStop(1, 'rgba(14, 165, 233, 0.52)');
      return g;
    },
  };
}

export function enhanceAdminBarDataset(
  ds: ChartDataset<'bar', number[]>,
): ChartDataset<'bar', number[]> {
  const rawColors = ds.backgroundColor;
  const baseColors = Array.isArray(rawColors)
    ? rawColors.map((c) => String(c))
    : [];

  return {
    ...ds,
    borderSkipped: false,
    borderWidth: 2,
    borderColor: baseColors.map((c) => shadeRgbaChannel(c, true)),
    borderRadius: {
      topLeft: 16,
      topRight: 16,
      bottomLeft: 8,
      bottomRight: 8,
    },
    maxBarThickness: 52,
    backgroundColor: (context: ScriptableContext<'bar'>) => {
      const idx = context.dataIndex;
      const c =
        baseColors[idx] ??
        (typeof rawColors === 'string' ? rawColors : 'rgba(85, 143, 195, 0.85)');
      const chart = context.chart;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(context.datasetIndex);
      const rawEl = meta?.data[idx];
      const el = rawEl instanceof BarElement ? rawEl : undefined;
      if (!el) return c;

      const { x, y, base } = el.getProps(['x', 'y', 'base'], true);
      const xn = typeof x === 'number' ? x : 0;
      const yn = typeof y === 'number' ? y : 0;
      const baseY = typeof base === 'number' ? base : yn;
      const top = Math.min(yn, baseY);
      const bottom = Math.max(yn, baseY);

      const g = ctx.createLinearGradient(xn, bottom, xn, top);
      g.addColorStop(0, shadeRgbaChannel(c, false));
      g.addColorStop(0.42, c);
      g.addColorStop(0.72, shadeRgbaChannel(c, true));
      g.addColorStop(1, shadeRgbaChannel(shadeRgbaChannel(c, true), true));
      return g;
    },
  };
}

export function enhanceAdminDoughnutDataset(
  ds: ChartDataset<'doughnut', number[]>,
): ChartDataset<'doughnut', number[]> {
  const rawBg = ds.backgroundColor;
  const baseColors = Array.isArray(rawBg)
    ? rawBg.map((c) => String(c))
    : [];

  return {
    ...ds,
    spacing: 5,
    hoverOffset: 16,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.42)',
    hoverBorderColor: 'rgba(255, 255, 255, 0.85)',
    hoverBorderWidth: 4,
    backgroundColor: (context: ScriptableContext<'doughnut'>) => {
      const idx = context.dataIndex;
      const base =
        baseColors[idx] ??
        (typeof rawBg === 'string' ? rawBg : 'rgba(85, 143, 195, 0.85)');
      const chart = context.chart;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(context.datasetIndex);
      const rawArc = meta?.data[idx];
      const arc = rawArc instanceof ArcElement ? rawArc : undefined;
      if (!arc) return base;
      const props = arc.getProps(
        ['x', 'y', 'innerRadius', 'outerRadius'],
        true,
      );
      const xi = typeof props.x === 'number' ? props.x : 0;
      const yi = typeof props.y === 'number' ? props.y : 0;
      const inner =
        typeof props.innerRadius === 'number' ? props.innerRadius : 0;
      const outer =
        typeof props.outerRadius === 'number' ? props.outerRadius : inner + 80;
      const g = ctx.createRadialGradient(xi, yi, inner, xi, yi, outer);
      g.addColorStop(0, shadeRgbaChannel(base, true));
      g.addColorStop(0.48, base);
      g.addColorStop(0.82, shadeRgbaChannel(base, false));
      g.addColorStop(
        1,
        shadeRgbaChannel(shadeRgbaChannel(base, false), false),
      );
      return g;
    },
  };
}
