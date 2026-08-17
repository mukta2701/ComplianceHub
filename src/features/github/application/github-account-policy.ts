export type GitHubAccountType = "Organization" | "User";

const INVALID_CONFIGURATION_ERROR =
  "GitHub account type configuration is invalid";

function invalidConfiguration(): never {
  throw new Error(INVALID_CONFIGURATION_ERROR);
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
    input.nodeEnv === "production" ||
    input.siteUrl === undefined
  ) {
    return invalidConfiguration();
  }

  let site: URL;

  try {
    site = new URL(input.siteUrl);
  } catch {
    return invalidConfiguration();
  }

  if (
    site.protocol !== "http:" ||
    (site.hostname !== "localhost" && site.hostname !== "127.0.0.1") ||
    site.username !== "" ||
    site.password !== "" ||
    input.siteUrl.includes("?") ||
    input.siteUrl.includes("#")
  ) {
    return invalidConfiguration();
  }

  return "User";
}
