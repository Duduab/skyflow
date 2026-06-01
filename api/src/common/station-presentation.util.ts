import type {
  ProjectLineMaterial,
  ProjectMachiningRoute,
} from '@prisma/client';

export type StationVariantOrder = {
  lineMaterial?: ProjectLineMaterial | null;
  machiningRoute?: ProjectMachiningRoute | null;
};

const STATION_NAMES_DEFAULT: Record<number, string> = {
  1: 'מסורים',
  2: 'CNC',
  3: 'הרכבה',
  4: 'הדבקות',
  5: 'פינישים',
  6: 'אריזה',
  7: 'הרכבה באתר',
};

/** שם תחנה בעברית לדשבורד / API (לפי וריאנט פרויקט) */
export function resolveStationDisplayNameHe(
  stationId: number,
  order?: StationVariantOrder | null,
): string {
  if (stationId === 1 && order?.lineMaterial === 'STEEL') {
    return 'מסגריה';
  }
  if (stationId === 2 && order?.machiningRoute === 'ALU_RANGER') {
    return 'Alu Ranger';
  }
  return STATION_NAMES_DEFAULT[stationId] ?? `תחנה ${stationId}`;
}
