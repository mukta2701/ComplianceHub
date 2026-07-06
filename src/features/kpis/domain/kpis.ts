export type MeasurementType = "automatic" | "manual" | "external";
export const MEASUREMENT_TYPE_LABEL: Record<MeasurementType, string> = { automatic: "Automatic", manual: "Manual", external: "External" };
export const MEASUREMENT_TYPE_TONE: Record<MeasurementType, string> = { automatic: "green", manual: "blue", external: "amber" };
export const KPI_REVIEW_MAX_AGE_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function needsReview(lastReviewed: string | null, today: string, maxAgeDays: number = KPI_REVIEW_MAX_AGE_DAYS): boolean {
  if (!ISO_DATE.test(today)) throw new RangeError("today must be an ISO date (YYYY-MM-DD)");
  if (lastReviewed === null) return true;
  if (!ISO_DATE.test(lastReviewed)) throw new RangeError("lastReviewed must be an ISO date (YYYY-MM-DD)");
  const ageMs = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastReviewed}T00:00:00Z`);
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}
