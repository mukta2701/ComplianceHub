import "server-only";

export type DailyDigestReservationMode = "bridge" | "strict";

export function dailyDigestReservationMode(): DailyDigestReservationMode {
  return process.env.DAILY_DIGEST_RESERVATION_MODE === "bridge" ? "bridge" : "strict";
}

function releaseSha(): string {
  const configured = process.env.COMPLIANCEHUB_RELEASE_SHA;
  return configured && /^[0-9a-f]{7,64}$/.test(configured) ? configured : "unknown";
}

export function complianceHubRuntimeCapabilities() {
  return {
    slackDestinationPolicy: "v1" as const,
    dailyDigestReservationMode: dailyDigestReservationMode(),
    releaseSha: releaseSha(),
  };
}
