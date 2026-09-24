export const DAILY_COLLECTION_REQUIRED_ENV: readonly string[];

export function missingDailyCollectionConfiguration(environment: Record<string, string | undefined>): string[];

export function invalidDailyCollectionConfiguration(environment: Record<string, string | undefined>): string[];

export function resolveDailyCollectionImageBinding(input: {
  registry: string;
  repository: string;
  imageIdentifier: string;
  liveHealth: { status?: string; releaseSha?: string };
  databaseHealth: { status?: string; db?: string };
  ecrImageDetails: { imageDigest?: string; imageTags?: string[] };
  eventName: string;
  expectedReleaseSha?: string;
}): { imageUri: string; imageDigest: string; releaseSha: string };

export function sanitizeDailyCollectionRunnerLog(log: string): {
  event: "github_daily_collection";
  complete: boolean;
  collectionHealth: "healthy" | "needs_attention";
  collection: {
    installationsChecked: number;
    repositoriesChecked: number;
    observationsStored: number;
    repositoriesFailed: number;
    repositoriesDeferred: number;
    runsPartial: number;
  };
  materialisation: {
    runsConsidered: number;
    materialised: number;
    unchanged: number;
    awaitingApproval: number;
    needsAttention: number;
  };
  materialisationFailed: boolean;
};
