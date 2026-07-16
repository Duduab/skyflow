export interface AssemblyPartsCheckState {
  checkedByUnit: Record<string, string[]>;
  highlightByUnit: Record<string, boolean>;
}

export function emptyAssemblyPartsCheck(): AssemblyPartsCheckState {
  return { checkedByUnit: {}, highlightByUnit: {} };
}

function isItemKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d+#\d+$/.test(v.trim());
}

export function assemblyPartsCheckFromLogPayload(
  extra: unknown,
): AssemblyPartsCheckState | null {
  if (!extra || typeof extra !== 'object') return null;
  const ep = extra as Record<string, unknown>;
  if (ep['assemblyPartsCheckSnapshot'] !== true) return null;

  const checkedByUnit: Record<string, string[]> = {};
  const rawChecked = ep['checkedByUnit'];
  if (rawChecked && typeof rawChecked === 'object' && !Array.isArray(rawChecked)) {
    for (const [unitCode, items] of Object.entries(
      rawChecked as Record<string, unknown>,
    )) {
      if (typeof unitCode !== 'string' || !unitCode.trim()) continue;
      if (!Array.isArray(items)) continue;
      const keys = items.filter(isItemKey).map((k) => k.trim());
      if (keys.length) checkedByUnit[unitCode.trim()] = keys;
    }
  }

  const highlightByUnit: Record<string, boolean> = {};
  const rawHighlight = ep['highlightByUnit'];
  if (
    rawHighlight &&
    typeof rawHighlight === 'object' &&
    !Array.isArray(rawHighlight)
  ) {
    for (const [unitCode, active] of Object.entries(
      rawHighlight as Record<string, unknown>,
    )) {
      if (typeof unitCode !== 'string' || !unitCode.trim()) continue;
      if (active === true) highlightByUnit[unitCode.trim()] = true;
    }
  }

  return { checkedByUnit, highlightByUnit };
}

export function countAssemblyPartsChecked(
  checkedByUnit: Record<string, string[]>,
): number {
  return Object.values(checkedByUnit).reduce((sum, items) => sum + items.length, 0);
}
