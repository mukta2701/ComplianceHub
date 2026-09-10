export type EvidenceStatus = "current" | "expiring" | "expired" | "superseded" | "withdrawn";
export type EvidenceKind = "file" | "link" | "note";
export const EXPIRY_WARNING_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addIsoDays(iso: string, days: number): string {
  if (!ISO_DATE.test(iso)) throw new RangeError("Dates must be ISO dates (YYYY-MM-DD)");
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function deriveEvidenceStatus(validUntil: string | null, today: string): "current" | "expiring" | "expired" {
  if (!ISO_DATE.test(today) || (validUntil !== null && !ISO_DATE.test(validUntil))) {
    throw new RangeError("Dates must be ISO dates (YYYY-MM-DD)");
  }
  if (validUntil === null) return "current";
  if (validUntil < today) return "expired";
  if (validUntil <= addIsoDays(today, EXPIRY_WARNING_DAYS)) return "expiring";
  return "current";
}

export function deriveEffectiveEvidenceStatus(status: EvidenceStatus, validUntil: string | null, today: string): EvidenceStatus {
  if (status === "withdrawn" || status === "superseded") return status;
  const datedStatus = deriveEvidenceStatus(validUntil, today);
  if (status === "expired" || datedStatus === "expired") return "expired";
  if (status === "expiring" || datedStatus === "expiring") return "expiring";
  return "current";
}

export function summariseEvidenceFreshness(items: readonly { status: EvidenceStatus }[]) {
  const live = items.filter((item) => item.status !== "superseded" && item.status !== "withdrawn");
  return {
    total: live.length,
    expiring: live.filter((item) => item.status === "expiring").length,
    expired: live.filter((item) => item.status === "expired").length,
  };
}
