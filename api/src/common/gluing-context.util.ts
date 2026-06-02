import {
  displayLabelWithoutSheetPrefix,
  lineQtyFromLabel,
} from '../planning/planning-assembly-media';

/** קודי יחידה להדבקות — רק GL-* (לא W-GL-1) */
const GL_UNIT_REF = /^GL[-A-Z0-9]+$/i;

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

export function unitCodeFromProductLabel(label: string): string | null {
  const stripped = displayLabelWithoutSheetPrefix(label);
  const token = stripped.match(/^([^\s(]+)/)?.[1]?.trim() ?? '';
  if (!GL_UNIT_REF.test(token)) return null;
  return token;
}

export function gluingDoneMapFromLogPayload(extra: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!extra || typeof extra !== 'object') return out;
  const bag = (extra as Record<string, unknown>)['gluingDoneByInstructionKind'];
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return out;
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof k === 'string' && k.trim() && v === true) {
      out[k.trim()] = true;
    }
  }
  return out;
}

export function typeNumFromInstructionKind(kind: string): string | null {
  const m = /^TYPE_(\d+)$/i.exec(kind.trim());
  return m ? m[1] : null;
}

function typeOrderKey(kind: string): number {
  const n = typeNumFromInstructionKind(kind);
  if (n) return parseInt(n, 10);
  return 9999;
}

export function sumGluingProgress(
  groups: Pick<GluingTypeGroupDto, 'done' | 'totalGlUnitQty'>[],
): Pick<
  GluingStationContextDto,
  'typesWithGluing' | 'typesDone' | 'totalGlUnitQty' | 'doneGlUnitQty'
> {
  const typesWithGluing = groups.length;
  const typesDone = groups.filter((g) => g.done).length;
  const totalGlUnitQty = groups.reduce((s, g) => s + g.totalGlUnitQty, 0);
  const doneGlUnitQty = groups
    .filter((g) => g.done)
    .reduce((s, g) => s + g.totalGlUnitQty, 0);
  return { typesWithGluing, typesDone, totalGlUnitQty, doneGlUnitQty };
}

export function buildGluingStationContext(
  items: {
    id: string;
    label: string;
    instructionKind: string;
    sortOrder: number;
  }[],
  sawWorkLines: {
    id: string;
    instructionKind: string;
    quantity: number;
  }[],
  cncByLineId: Record<string, number>,
  gluingDoneByKind: Record<string, boolean>,
): GluingStationContextDto {
  const unitsByKind = new Map<string, GluingUnitDto[]>();

  for (const item of items) {
    const kind = (item.instructionKind ?? '').trim();
    if (!kind || kind === 'WINDOW_INSTRUCTION') continue;
    const unitCode = unitCodeFromProductLabel(item.label);
    if (!unitCode) continue;

    const quantity = lineQtyFromLabel(item.label);
    const displayLabel =
      quantity > 1 ? `${unitCode} (×${quantity})` : unitCode;

    const arr = unitsByKind.get(kind) ?? [];
    arr.push({
      productItemId: item.id,
      unitCode,
      quantity,
      displayLabel,
    });
    unitsByKind.set(kind, arr);
  }

  const cncByKind = new Map<string, { done: number; target: number }>();
  for (const line of sawWorkLines) {
    const kind = (line.instructionKind ?? '').trim();
    if (!kind || kind === 'WINDOW_INSTRUCTION') continue;
    const qty = Math.max(0, line.quantity);
    const cncRaw = cncByLineId[line.id] ?? 0;
    const cncDone = Math.min(qty, Math.max(0, Math.floor(cncRaw)));
    const cur = cncByKind.get(kind) ?? { done: 0, target: 0 };
    cur.done += cncDone;
    cur.target += qty;
    cncByKind.set(kind, cur);
  }

  const groups: GluingTypeGroupDto[] = [];
  for (const [instructionKind, units] of unitsByKind.entries()) {
    units.sort((a, b) => a.unitCode.localeCompare(b.unitCode));
    const totalGlUnitQty = units.reduce((s, u) => s + u.quantity, 0);
    const cnc = cncByKind.get(instructionKind) ?? { done: 0, target: 0 };
    const cncComplete = cnc.target > 0 && cnc.done >= cnc.target;
    const locked = !cncComplete;
    const done = gluingDoneByKind[instructionKind] === true;

    groups.push({
      instructionKind,
      typeNum: typeNumFromInstructionKind(instructionKind),
      units,
      totalGlUnitQty,
      done,
      locked,
      cncDoneQty: cnc.done,
      cncTargetQty: cnc.target,
    });
  }

  groups.sort((a, b) => {
    const da = typeOrderKey(a.instructionKind);
    const db = typeOrderKey(b.instructionKind);
    if (da !== db) return da - db;
    return a.instructionKind.localeCompare(b.instructionKind);
  });

  return {
    groups,
    ...sumGluingProgress(groups),
  };
}
