export type MeasurementReading = { value: number; measured_on: string };
export type MeasurementDirection = "up" | "down" | "flat";
export type MeasurementSummary = {
  latest: number | null;
  previous: number | null;
  delta: number | null;
  direction: MeasurementDirection | null;
  count: number;
};

// Summarise a KPI's readings into a compact trend. Readings are sorted
// chronologically (ties broken by input order); latest/previous are the two
// most recent values and delta = latest − previous. Direction is null until
// there is something to compare against.
export function summariseMeasurements(readings: MeasurementReading[]): MeasurementSummary {
  const sorted = [...readings].sort((a, b) => (a.measured_on < b.measured_on ? -1 : a.measured_on > b.measured_on ? 1 : 0));
  const count = sorted.length;
  if (count === 0) return { latest: null, previous: null, delta: null, direction: null, count };
  const latest = sorted[count - 1].value;
  if (count === 1) return { latest, previous: null, delta: null, direction: null, count };
  const previous = sorted[count - 2].value;
  const delta = latest - previous;
  const direction: MeasurementDirection = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { latest, previous, delta, direction, count };
}
