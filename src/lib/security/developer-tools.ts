type DeveloperToolEnvironment = {
  nodeEnv: string | undefined;
  enabled: boolean;
  siteUrl: string | undefined;
};

export function canShowDeveloperTools(environment: DeveloperToolEnvironment): boolean {
  if (environment.nodeEnv === "development") return true;
  if (!environment.enabled || !environment.siteUrl) return false;
  try {
    const hostname = new URL(environment.siteUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
