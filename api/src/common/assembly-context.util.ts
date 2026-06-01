import type { ProductComponent } from '@prisma/client';
import {
  displayLabelWithoutSheetPrefix,
  lineQtyFromLabel,
} from '../planning/planning-assembly-media';

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
  /** כמות חלונות לסוג זה (מ־×N בלייבל) */
  quantity: number;
  /** כמה חלונות הורכבו בפועל */
  assembledQty: number;
  imagePaths: string[];
  specs: AssemblyWindowSpecDto[];
  components: AssemblyWindowComponentDto[];
  /** הורכבו כל החלונות לסוג זה */
  assembled: boolean;
}

export interface AssemblyStationContextDto {
  pipeline: AssemblyPipelineLineDto[];
  windows: AssemblyWindowUnitDto[];
  pipelineReadyCount: number;
  pipelineTotalCount: number;
  /** סוגי יחידה (GL-2, W-GL-1…) */
  windowsUnitCount: number;
  /** סה״כ חלונות לפי כמויות בתכנון */
  windowsTotalQty: number;
  windowsAssembledQty: number;
}

function normHeader(h: string): string {
  return h.replace(/\s+/g, ' ').trim().toLowerCase();
}

function specPairFromComponent(c: ProductComponent): AssemblyWindowSpecDto | null {
  const spec = c.spec?.trim();
  const desc = c.description?.trim() ?? '';
  if (spec) {
    const label = desc.length > 48 ? `${desc.slice(0, 45)}…` : desc || c.kind;
    return { label, value: spec };
  }
  const h = normHeader(desc);
  if (h.includes('width') || h.includes('רוחב')) {
    return { label: 'רוחב', value: desc };
  }
  if (h.includes('height') || h.includes('גובה')) {
    return { label: 'גובה', value: desc };
  }
  return null;
}

function componentLine(c: ProductComponent): string {
  const spec = c.spec?.trim();
  const q = Math.max(1, Math.floor(Number(c.quantity) || 1));
  const base = spec
    ? `${c.description} — ${spec}`
    : c.description;
  return q > 1 ? `${base} · ×${q}` : base;
}

export function assembledQtyMapFromLogPayload(extra: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!extra || typeof extra !== 'object') return out;
  const bag = (extra as Record<string, unknown>)['assembledQtyByItemId'];
  if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
    for (const [id, v] of Object.entries(bag as Record<string, unknown>)) {
      const n = Number(v);
      if (typeof id === 'string' && id.trim() && Number.isFinite(n) && n > 0) {
        out[id.trim()] = Math.floor(n);
      }
    }
    return out;
  }
  const arr = (extra as Record<string, unknown>)['assembledProductItemIds'];
  if (!Array.isArray(arr)) return out;
  for (const id of arr) {
    if (typeof id === 'string' && id.trim()) out[id.trim()] = 1;
  }
  return out;
}

export function sumAssemblyWindowQty(
  windows: Pick<AssemblyWindowUnitDto, 'quantity' | 'assembledQty'>[],
): { totalQty: number; assembledQty: number } {
  let totalQty = 0;
  let assembledQty = 0;
  for (const w of windows) {
    const q = Math.max(0, Math.floor(w.quantity));
    const a = Math.min(q, Math.max(0, Math.floor(w.assembledQty)));
    totalQty += q;
    assembledQty += a;
  }
  return { totalQty, assembledQty };
}

export function buildAssemblyPipelineLines(
  lines: {
    id: string;
    instructionKind: string;
    description: string;
    quantity: number;
    sortOrder: number;
    imagePaths: string[];
    sawsProfileCode: string | null;
    planningCutLengthMm: number | null;
  }[],
  sawnByLineId: Record<string, number>,
  cncByLineId: Record<string, number>,
): AssemblyPipelineLineDto[] {
  return lines
    .filter((l) => (l.instructionKind ?? '').trim() !== 'WINDOW_INSTRUCTION')
    .map((line) => {
      const qty = Math.max(0, line.quantity);
      const sawnRaw = sawnByLineId[line.id] ?? 0;
      const cncRaw = cncByLineId[line.id] ?? 0;
      const sawnQty = Math.min(qty, Math.max(0, Math.floor(sawnRaw)));
      const cncDoneQty = Math.min(qty, Math.max(0, Math.floor(cncRaw)));
      let status: AssemblyPipelineStatus = 'locked';
      if (sawnQty <= 0) status = 'locked';
      else if (cncDoneQty < qty) status = 'saw_only';
      else status = 'ready';

      return {
        id: line.id,
        instructionKind: line.instructionKind,
        description: line.description,
        quantity: qty,
        sortOrder: line.sortOrder,
        imagePaths: line.imagePaths ?? [],
        sawsProfileCode: line.sawsProfileCode,
        planningCutLengthMm: line.planningCutLengthMm,
        sawnQty,
        cncDoneQty,
        status,
      };
    });
}

export function buildAssemblyWindowUnits(
  items: {
    id: string;
    label: string;
    components: ProductComponent[];
  }[],
  itemImages: Record<string, string[]>,
  assembledQtyById: Record<string, number>,
): AssemblyWindowUnitDto[] {
  return items.map((item) => {
    const specs: AssemblyWindowSpecDto[] = [];
    const seen = new Set<string>();
    for (const c of item.components) {
      const pair = specPairFromComponent(c);
      if (pair) {
        const key = `${pair.label}|${pair.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          specs.push(pair);
        }
      }
    }
    if (specs.length > 6) specs.length = 6;

    const quantity = lineQtyFromLabel(item.label);
    const raw = assembledQtyById[item.id] ?? 0;
    const assembledQty = Math.min(
      quantity,
      Math.max(0, Math.floor(Number(raw) || 0)),
    );

    return {
      id: item.id,
      displayLabel: displayLabelWithoutSheetPrefix(item.label),
      quantity,
      assembledQty,
      imagePaths: itemImages[item.id] ?? [],
      specs,
      components: item.components.slice(0, 24).map((c) => ({
        kind: c.kind,
        line: componentLine(c),
      })),
      assembled: quantity > 0 && assembledQty >= quantity,
    };
  });
}
