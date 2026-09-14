export const ACTIVE_MONITORING_FINDING_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "exception_requested",
  "risk_accepted",
] as const;

export const MONITORING_FINDING_STATUSES = [
  ...ACTIVE_MONITORING_FINDING_STATUSES,
  "resolved",
] as const;

export type ActiveMonitoringFindingStatus = typeof ACTIVE_MONITORING_FINDING_STATUSES[number];
export type MonitoringFindingStatus = typeof MONITORING_FINDING_STATUSES[number];
