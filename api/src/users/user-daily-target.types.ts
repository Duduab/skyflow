export type UserDailyTargetLineItemRow = {
  sortOrder: number;
  description: string;
  profileCode: string | null;
  cutLengthMm: number | null;
  instructionKind: string;
  targetQty: number;
};

export type UserDailyTargetItemRow = {
  id: string;
  source: 'MANUAL' | 'PLANNING';
  description: string;
  targetMinutes: number;
  targetQty: number | null;
  actualQty: number;
  achievementPct: number | null;
  projectId: string | null;
  projectName: string | null;
  stationId: number | null;
  stationName: string | null;
  lineItems: UserDailyTargetLineItemRow[];
};

export type UserDailyTargetDayRow = {
  date: string;
  description: string | null;
  targetMinutes: number | null;
  targetQty: number | null;
  actualMinutes: number;
  actualQty: number;
  achievementPct: number | null;
  reports: number;
  processedQty: number;
  hasTarget: boolean;
  items: UserDailyTargetItemRow[];
};

export type UserDailyTargetsResponse = {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    photoUrl: string | null;
    managedStationId: number | null;
  };
  todayKey: string;
  today: UserDailyTargetDayRow | null;
  history: UserDailyTargetDayRow[];
};
