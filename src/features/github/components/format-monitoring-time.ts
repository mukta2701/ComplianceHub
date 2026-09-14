const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Client components also render on the server. Use numeric zoned parts and
// fixed text: Node and Safari disagree on locale abbreviations and separators.
export function formatMonitoringTime(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    numberingSystem: "latn",
    calendar: "gregory",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part("day")} ${MONTHS[Number(part("month")) - 1]} ${part("year")}, ${part("hour")}:${part("minute")}`;
}
