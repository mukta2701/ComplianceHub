export type GitHubAccountType = "Organization" | "User";

const INVALID_CONFIGURATION_ERROR =
  "GitHub account type configuration is invalid";

const CANONICAL_LOCAL_USER_SITE =
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::[1-9]\d{0,4})?\/?$/;

function invalidConfiguration(): never {
  throw new Error(INVALID_CONFIGURATION_ERROR);
}

function isCanonicalLocalUserSite(siteUrl: string): boolean {
  return CANONICAL_LOCAL_USER_SITE.test(siteUrl) && URL.canParse(siteUrl);
}

export function resolveGitHubAccountType(input: {
  configuredType?: string;
  nodeEnv?: string;
  siteUrl?: string;
}): GitHubAccountType {
  if (input.configuredType === undefined || input.configuredType === "") {
    return "Organization";
  }

  if (input.configuredType === "Organization") {
    return "Organization";
  }

  if (
    input.configuredType !== "User" ||
    (input.nodeEnv !== "development" && input.nodeEnv !== "test") ||
    input.siteUrl === undefined ||
    !isCanonicalLocalUserSite(input.siteUrl)
  ) {
    return invalidConfiguration();
  }

  return "User";
}
