export type ObservationResult = "pass" | "fail" | "unknown" | "not_applicable";

export type ObservationSeverity = "low" | "medium" | "high" | "critical";

export type DiagnosticCode =
  | "permission_denied"
  | "feature_unavailable"
  | "not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_response";

export type DataState<T> =
  | { state: "available"; value: T }
  | { state: "unavailable"; diagnosticCode: DiagnosticCode };

export type GitHubFactSet = {
  repository: {
    id: number;
    owner: string;
    name: string;
    visibility: "public" | "private" | "internal";
    archived: boolean;
    defaultBranch: string;
    url: string;
  };
  branchProtection: DataState<{
    forcePushesBlocked: boolean;
    deletionsBlocked: boolean;
    approvingReviews: number;
    dismissesStaleReviews: boolean;
    codeOwnerReviews: boolean;
    requiredStatusChecks: string[];
  }>;
  dependabot: DataState<{ openHigh: number; openCritical: number }>;
  codeScanning: DataState<{ openHigh: number; openCritical: number }>;
  secretScanning: DataState<{
    enabled: boolean;
    pushProtectionEnabled: boolean;
    openAlerts: number;
  }>;
  securityWorkflows: DataState<
    Array<{ name: string; approved: boolean; active: boolean; latestConclusion: string | null }>
  >;
  administration: DataState<{ outsideCollaboratorAdmins: number }>;
};

export type GitHubObservation = {
  observationKey: string;
  runId: string;
  repositoryId: number;
  checkId: string;
  ruleVersion: string;
  subjectType: "github_repository";
  subjectId: string;
  result: ObservationResult;
  severity: ObservationSeverity | null;
  title: string;
  explanation: string;
  remediation: string | null;
  observedAt: string;
  freshUntil: string;
  sourceUrl: string;
  fingerprint: string;
  diagnosticCode: DiagnosticCode | null;
};
