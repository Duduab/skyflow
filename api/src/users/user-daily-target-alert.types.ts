export type UserDailyTargetAlertLevel = 'warning' | 'missed';

export type UserDailyTargetAlertRow = {
  userId: string;
  firstName: string;
  lastName: string;
  description: string;
  targetMinutes: number;
  actualMinutes: number;
  achievementPct: number;
  level: UserDailyTargetAlertLevel;
};

export type UserDailyTargetAlertsResponse = {
  todayKey: string;
  alerts: UserDailyTargetAlertRow[];
};
