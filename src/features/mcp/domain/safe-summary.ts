const URL_PATTERN = /https?:\/\/[^\s]+/giu;
const EMAIL_PATTERN = /\b[\p{L}\p{N}.+_-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu;
const AUTHORIZATION_PATTERN = /\bauthorization\s*:\s*(?:basic|bearer)\s+[^\s,;]+/giu;
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/giu;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)? PRIVATE KEY-----|$)/giu;
const SECRET_LABEL_PATTERN = [
  String.raw`client[\s_-]?secret`,
  String.raw`private[\s_-]?key`,
  String.raw`aws[\s_-]?secret[\s_-]?access[\s_-]?key`,
  String.raw`secret[\s_-]?access[\s_-]?key`,
  String.raw`access[\s_-]?key[\s_-]?id`,
  String.raw`signing[\s_-]?secret`,
  String.raw`web` + String.raw`hook(?:[\s_-]?(?:url|secret|token))?`,
  String.raw`api[\s_-]?key`,
  String.raw`access[\s_-]?token`,
  String.raw`refresh[\s_-]?token`,
  "token", "secret", "password",
].join("|");
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(?:${SECRET_LABEL_PATTERN})\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)`,
  "giu",
);
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const CREDENTIAL_SHAPE_PATTERN = /\b(?:sk-(?:proj-)?[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{8,}|xox[baprs]-[a-z0-9-]{8,}|eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{4,})\b/giu;
const MARKUP_PATTERN = /<[^>]*>/gu;

const sensitiveCredentialPatterns = [
  PRIVATE_KEY_BLOCK_PATTERN,
  AUTHORIZATION_PATTERN,
  SECRET_ASSIGNMENT_PATTERN,
  AWS_ACCESS_KEY_PATTERN,
  BEARER_PATTERN,
  CREDENTIAL_SHAPE_PATTERN,
] as const;

export function containsSensitiveCredential(value: string): boolean {
  return sensitiveCredentialPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function redactCredentials(value: string): string {
  return sensitiveCredentialPatterns.reduce((output, pattern) => {
    pattern.lastIndex = 0;
    return output.replace(pattern, "[redacted]");
  }, value);
}

function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return `${points.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** Produces a short, deterministic summary suitable for MCP output. */
export function safeSummary(value: unknown, max = 240, fallback = "Untitled item"): string {
  if (!Number.isInteger(max) || max < 1) throw new RangeError("Summary length must be a positive integer");
  const input = typeof value === "string" ? value : "";
  const cleaned = redactCredentials(input)
    .replace(MARKUP_PATTERN, "[redacted]")
    .replace(/[<>]/gu, "")
    .replace(URL_PATTERN, "[redacted]")
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(/(?:\[redacted\]\s*){2,}/giu, "[redacted] ")
    .replace(/\s+/gu, " ")
    .trim();
  const safeFallback = String(fallback).replace(/\s+/gu, " ").trim() || "Item";
  return truncateCodePoints(cleaned || safeFallback, max);
}
