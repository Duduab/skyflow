export type UserPerformanceSummary = {
  totalReports: number;
  totalProcessedQty: number;
  projectsTouched: number;
  activeDays: number;
  estimatedActiveHours: number;
  todayReports: number;
  yesterdayReports: number;
  todayProcessedQty: number;
  yesterdayProcessedQty: number;
  avgReportsPerActiveDay: number;
  weeklyReports: number;
  paceVsPlantPct: number | null;
  lastActivityAt: string | null;
  firstActivityAt: string | null;
};

export type UserPerformanceStationRow = {
  stationId: number;
  reports: number;
  processedQty: number;
};

export type UserPerformanceDayRow = {
  date: string;
  reports: number;
  processedQty: number;
  estimatedHours: number;
};

export type UserPerformanceActivityRow = {
  id: string;
  createdAt: string;
  stationId: number;
  projectId: string;
  projectName: string;
  processedQty: number;
  issues: string | null;
};

export type UserPerformanceResponse = {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    photoUrl: string | null;
    managedStationId: number | null;
  };
  summary: UserPerformanceSummary;
  byStation: UserPerformanceStationRow[];
  dailyActivity: UserPerformanceDayRow[];
  recentActivity: UserPerformanceActivityRow[];
};
