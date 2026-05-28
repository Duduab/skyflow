export interface ParsedPlanningComponentLabel {
  raw: string;
  isOverflow: boolean;
  kind?: string;
  kindDisplay?: string;
  title?: string;
  spec?: string;
  width?: string;
  height?: string;
  unit?: string;
  qty?: number;
}

const QTY_SUFFIX = /\s·\s×(\d+)\s*$/;
const DIM_SPEC =
  /^(\d+(?:[.,]\d+)?)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i;

export function parsePlanningComponentLabel(
  label: string,
): ParsedPlanningComponentLabel {
  const raw = label.trim();
  if (!raw || raw.startsWith('…')) {
    return { raw, isOverflow: true };
  }

  let rest = raw;
  let qty: number | undefined;

  const qtyM = rest.match(QTY_SUFFIX);
  if (qtyM) {
    qty = parseInt(qtyM[1], 10);
    rest = rest.slice(0, qtyM.index).trim();
  }

  let kind: string | undefined;
  let title: string | undefined;
  let spec: string | undefined;

  const dashIdx = rest.indexOf(' — ');
  if (dashIdx >= 0) {
    spec = rest.slice(dashIdx + 3).trim();
    rest = rest.slice(0, dashIdx).trim();
  }

  const colonIdx = rest.indexOf(': ');
  if (colonIdx >= 0) {
    kind = rest.slice(0, colonIdx).trim();
    title = rest.slice(colonIdx + 2).trim();
  } else {
    title = rest;
  }

  let width: string | undefined;
  let height: string | undefined;
  let unit: string | undefined;

  if (spec) {
    const dimM = spec.match(DIM_SPEC);
    if (dimM) {
      width = dimM[1].replace(',', '.');
      height = dimM[2].replace(',', '.');
      unit = (dimM[3] || 'mm').toLowerCase();
      spec = undefined;
    }
  }

  const kindDisplay = kind
    ? kind.replace(/_/g, ' ').replace(/\s+/g, ' ')
    : undefined;

  return {
    raw,
    isOverflow: false,
    kind,
    kindDisplay,
    title: title || undefined,
    spec: spec || undefined,
    width,
    height,
    unit,
    qty: qty && qty > 1 ? qty : undefined,
  };
}
