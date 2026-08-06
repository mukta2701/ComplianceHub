const URL_PATTERN = /https?:\/\/[^\s]+/giu;
const EMAIL_PATTERN = /\b[\p{L}\p{N}.+_-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu;
const BEARER_PATTERN = /\bbearer\s+[^\s]+/giu;
const TOKEN_PATTERN = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[:=]\s*[^\s]+/giu;
const CREDENTIAL_SHAPE_PATTERN = /\b(?:sk-(?:proj-)?[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{8,}|xox[baprs]-[a-z0-9-]{8,}|eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{4,})\b/giu;
const MARKUP_PATTERN = /<[^>]*>/gu;

function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return `${points.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** Produces a short, deterministic summary suitable for MCP output. */
export function safeSummary(value: unknown, max = 240, fallback = "Untitled item"): string {
  if (!Number.isInteger(max) || max < 1) throw new RangeError("Summary length must be a positive integer");
  const input = typeof value === "string" ? value : "";
  const cleaned = input
    .replace(MARKUP_PATTERN, "[redacted]")
    .replace(/[<>]/gu, "")
    .replace(URL_PATTERN, "[redacted]")
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(BEARER_PATTERN, "[redacted]")
    .replace(TOKEN_PATTERN, "[redacted]")
    .replace(CREDENTIAL_SHAPE_PATTERN, "[redacted]")
    .replace(/(?:\[redacted\]\s*){2,}/giu, "[redacted] ")
    .replace(/\s+/gu, " ")
    .trim();
  const safeFallback = String(fallback).replace(/\s+/gu, " ").trim() || "Item";
  return truncateCodePoints(cleaned || safeFallback, max);
}
