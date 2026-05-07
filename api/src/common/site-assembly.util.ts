/** Shared site-assembly (station 7) progress — used by API + admin line average */
export interface SiteExpectedCounts {
  beams: number;
  glazing: number;
  unitized: number;
}

export interface SiteAssembledCounts {
  beams: number;
  glazing: number;
  unitized: number;
}

export function computeSiteAssemblyPercent(
  deliveryNotePath: string | null | undefined,
  expected: SiteExpectedCounts,
  assembled: SiteAssembledCounts,
): number {
  if (!deliveryNotePath?.trim()) return 0;
  const ratioPct = (a: number, e: number) =>
    e > 0 ? Math.min(100, Math.round((a / e) * 100)) : 0;
  return Math.round(
    (ratioPct(assembled.beams, expected.beams) +
      ratioPct(assembled.glazing, expected.glazing) +
      ratioPct(assembled.unitized, expected.unitized)) /
      3,
  );
}

export function assembledFromLogPayload(
  extraPayload: unknown,
): SiteAssembledCounts {
  const ep = extraPayload as Record<string, unknown> | null | undefined;
  return {
    beams: Number(ep?.['assembledBeams'] ?? 0),
    glazing: Number(ep?.['assembledGlazing'] ?? 0),
    unitized: Number(ep?.['assembledUnitized'] ?? 0),
  };
}
