export type ProjectLineMaterial = 'ALUMINUM' | 'STEEL';
export type ProjectMachiningRoute = 'GLASS' | 'ALU_RANGER';

export type StationVariantOrder = {
  lineMaterial?: ProjectLineMaterial | null;
  machiningRoute?: ProjectMachiningRoute | null;
};

export type StationVisualVariant = 'default' | 'steelworkshop' | 'aluranger';

export interface StationVisualTokens {
  accent: string;
  glow: string;
  heroImage: string;
}

const DEFAULT_TOKENS: Record<number, StationVisualTokens> = {
  1: {
    accent: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.42)',
    heroImage: '/assets/stations/1.png',
  },
  2: {
    accent: '#22d3ee',
    glow: 'rgba(34, 211, 238, 0.38)',
    heroImage: '/assets/stations/2.png',
  },
  3: {
    accent: '#34d399',
    glow: 'rgba(52, 211, 153, 0.38)',
    heroImage: '/assets/stations/3.png',
  },
  4: {
    accent: '#d8b4fe',
    glow: 'rgba(216, 180, 254, 0.38)',
    heroImage: '/assets/stations/4.png',
  },
  5: {
    accent: '#fb7185',
    glow: 'rgba(251, 113, 133, 0.38)',
    heroImage: '/assets/stations/5.png',
  },
  6: {
    accent: '#6ee7b7',
    glow: 'rgba(110, 231, 183, 0.38)',
    heroImage: '/assets/stations/6.png',
  },
  7: {
    accent: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.4)',
    heroImage: '/assets/stations/6.png',
  },
  8: {
    accent: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.4)',
    heroImage: '/assets/stations/8.png',
  },
};

const VARIANT_TOKENS: Record<StationVisualVariant, Partial<Record<number, StationVisualTokens>>> = {
  default: {},
  steelworkshop: {
    1: {
      accent: '#f97316',
      glow: 'rgba(249, 115, 22, 0.42)',
      heroImage: '/assets/stations/1-steelworkshop.png',
    },
  },
  aluranger: {
    2: {
      accent: '#94a3b8',
      glow: 'rgba(56, 189, 248, 0.38)',
      heroImage: '/assets/stations/2-aluranger.png',
    },
  },
};

/**
 * סדר הזרימה ברצפת הייצור. תחנת הלייזר (ID פנימי 8) משובצת לפני ההרכבה (3)
 * כשהיא פעילה (לייזר פנימי עם זוויות). ה-ID הפנימי נשאר 8 לשמירת תאימות.
 */
export function workerFlowSequence(laserActive: boolean): number[] {
  return laserActive ? [1, 2, 8, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6, 7];
}

/** מספר התצוגה של תחנה לעובד — לפי מיקומה בזרימה (1-based), לא לפי ה-ID הפנימי. */
export function stationDisplayNumber(
  stationId: number,
  laserActive: boolean,
): number {
  const idx = workerFlowSequence(laserActive).indexOf(stationId);
  return idx >= 0 ? idx + 1 : stationId;
}

export function stationLabelKey(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): string {
  if (stationId === 1 && order?.lineMaterial === 'STEEL') {
    return 'STATIONS.1_STEELWORKSHOP';
  }
  if (stationId === 2 && order?.machiningRoute === 'ALU_RANGER') {
    return 'STATIONS.2_ALU_RANGER';
  }
  return `STATIONS.${stationId}`;
}

export function stationDescKey(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): string {
  if (stationId === 1 && order?.lineMaterial === 'STEEL') {
    return 'WORKER_HUB.STATION_DESC_1_STEELWORKSHOP';
  }
  if (stationId === 2 && order?.machiningRoute === 'ALU_RANGER') {
    return 'WORKER_HUB.STATION_DESC_2_ALU_RANGER';
  }
  return `WORKER_HUB.STATION_DESC_${stationId}`;
}

export function stationVisualVariant(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): StationVisualVariant {
  if (stationId === 1 && order?.lineMaterial === 'STEEL') {
    return 'steelworkshop';
  }
  if (stationId === 2 && order?.machiningRoute === 'ALU_RANGER') {
    return 'aluranger';
  }
  return 'default';
}

export function stationVisualModifierClass(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): string | null {
  const v = stationVisualVariant(order, stationId);
  if (v === 'steelworkshop') return 'station-visual--steelworkshop';
  if (v === 'aluranger') return 'station-visual--aluranger';
  return null;
}

export function stationHeroImagePath(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): string {
  return stationVisualTokens(order, stationId).heroImage;
}

/** Canonical Material Symbols icon for any station id. */
export function stationMatIcon(stationId: number): string {
  switch (stationId) {
    case 2:
      return 'precision_manufacturing';
    case 3:
      return 'handyman';
    case 4:
      return 'window';
    case 5:
      return 'check';
    case 6:
      return 'inventory_2';
    case 7:
      return 'apartment';
    case 8:
      return 'flare';
    default:
      return 'carpenter';
  }
}

/** Filled icon for station — finishes (5) uses outline check only. */
export function stationMatIconFilled(stationId: number): boolean {
  return stationId !== 5;
}

export function stationVisualTokens(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): StationVisualTokens {
  const variant = stationVisualVariant(order, stationId);
  const override = VARIANT_TOKENS[variant][stationId];
  const base = DEFAULT_TOKENS[stationId];
  if (override && base) {
    return { ...base, ...override };
  }
  if (override) return override;
  if (base) return base;
  return {
    accent: '#558fc3',
    glow: 'rgba(85, 143, 195, 0.35)',
    heroImage: `/assets/stations/${stationId}.png`,
  };
}

/** Inline CSS variables for hub card / station brief */
export function stationVisualStyle(
  order: StationVariantOrder | null | undefined,
  stationId: number,
): Record<string, string> {
  const t = stationVisualTokens(order, stationId);
  return {
    '--accent': t.accent,
    '--brief-accent': t.accent,
    '--hero-image': `url('${t.heroImage}')`,
    '--brief-hero-image': `url('${t.heroImage}')`,
    '--hero-glow': t.glow,
    '--brief-glow': t.glow,
    '--card-glow': t.glow,
  };
}

/** מפתח i18n לכותרת מנהל תחנה 1 במסך תכנון */
export function planningStation1ManagerSectionKey(
  order: StationVariantOrder | null | undefined,
): string {
  return order?.lineMaterial === 'STEEL'
    ? 'PLANNING_NEW.WIZARD_SECTION_STEELWORKSHOP_MANAGER'
    : 'PLANNING_NEW.WIZARD_SECTION_SAWS_MANAGER';
}

/** מפתח CTA אישור תכנון — תחנת יעד ראשונה */
export function planningApproveCtaKey(
  order: StationVariantOrder | null | undefined,
): string {
  return order?.lineMaterial === 'STEEL'
    ? 'PLANNING.APPROVE_CTA_STEELWORKSHOP'
    : 'PLANNING.APPROVE_CTA';
}
