import type { z } from "zod";

export type FieldCoercion = { ok: true; value: string | number | boolean | null } | { ok: false; error: string };
export type TargetField = { key: string; label: string; required: boolean; aliases: string[]; coerce: (raw: string) => FieldCoercion };
export type ColumnMapping = Record<string, string | null>;
export type RowResult = { ok: true; values: Record<string, string | number | boolean | null> } | { ok: false; errors: string[] };

// Shared across the module adapters (risk/soa/asset) and their registry.
export type ImportModule = "risk" | "soa" | "asset";
export type ImportAdapter = { module: ImportModule; label: string; fields: TargetField[]; rowSchema: z.ZodType };

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_/()?:.\-]+/g, " ").trim();

export function reverseLabels<T extends string>(labels: Record<T, string>): (raw: string) => T | null {
  const map = new Map<string, T>();
  for (const key of Object.keys(labels) as T[]) { map.set(key.toLowerCase(), key); map.set(labels[key].toLowerCase(), key); }
  return (raw) => map.get(raw.trim().toLowerCase()) ?? null;
}

export function textField(key: string, label: string, required: boolean, aliases: string[], maxLength = 10_000): TargetField {
  return { key, label, required, aliases, coerce: (raw) => (raw.length <= maxLength ? { ok: true, value: raw } : { ok: false, error: `must be ${maxLength} characters or fewer` }) };
}

export function enumField<T extends string>(key: string, label: string, required: boolean, aliases: string[], labels: Record<T, string>): TargetField {
  const rev = reverseLabels(labels);
  return { key, label, required, aliases, coerce: (raw) => { const v = rev(raw); return v ? { ok: true, value: v } : { ok: false, error: `unrecognised value "${raw}"` }; } };
}

export function intField(key: string, label: string, required: boolean, aliases: string[], min = 1, max = 5): TargetField {
  return { key, label, required, aliases, coerce: (raw) => { const n = Number(raw); return Number.isInteger(n) && n >= min && n <= max ? { ok: true, value: n } : { ok: false, error: `must be a whole number ${min}–${max}` }; } };
}

export function boolField(key: string, label: string, required: boolean, aliases: string[]): TargetField {
  return { key, label, required, aliases, coerce: (raw) => {
    const t = raw.trim().toLowerCase();
    if (["yes", "y", "true", "1", "applicable"].includes(t)) return { ok: true, value: true };
    if (["no", "n", "false", "0", "not applicable"].includes(t)) return { ok: true, value: false };
    return { ok: false, error: 'must be "Yes" or "No"' };
  } };
}

// Regex only checks the DD/MM/YYYY *shape* — "31/02/2026" and "2026-13-40" match the
// pattern but aren't real dates. Confirm the components round-trip through Date.UTC
// (which normalises out-of-range values, e.g. Feb 31 -> Mar 3) to reject impossible dates.
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function dateField(key: string, label: string, required: boolean, aliases: string[]): TargetField {
  const invalid = { ok: false as const, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" };
  return { key, label, required, aliases, coerce: (raw) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (iso) {
      const [, y, m, d] = iso;
      return isValidCalendarDate(Number(y), Number(m), Number(d)) ? { ok: true, value: `${y}-${m}-${d}` } : invalid;
    }
    const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim());
    if (uk) {
      const y = uk[3].length === 2 ? 2000 + Number(uk[3]) : Number(uk[3]);
      const d = Number(uk[1]), m = Number(uk[2]);
      return isValidCalendarDate(y, m, d) ? { ok: true, value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` } : invalid;
    }
    return invalid;
  } };
}

export function suggestMapping(headers: readonly string[], fields: readonly TargetField[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const header of headers) {
    const h = norm(header);
    const match = fields.find((f) => !used.has(f.key) && (norm(f.label) === h || f.aliases.some((a) => norm(a) === h)));
    mapping[header] = match?.key ?? null;
    if (match) used.add(match.key);
  }
  return mapping;
}

export function coerceAndValidate(
  headers: readonly string[],
  rows: readonly string[][],
  mapping: ColumnMapping,
  fields: readonly TargetField[],
  rowSchema?: z.ZodType,
): RowResult[] {
  const colByKey = new Map<string, number>();
  headers.forEach((h, i) => { const k = mapping[h]; if (k) colByKey.set(k, i); });
  return rows.map((row) => {
    const values: Record<string, string | number | boolean | null> = {};
    const errors: string[] = [];
    for (const field of fields) {
      const col = colByKey.get(field.key);
      const raw = col === undefined ? "" : (row[col] ?? "").trim();
      if (!raw) { if (field.required) errors.push(`${field.label} is required`); values[field.key] = null; continue; }
      const result = field.coerce(raw);
      if (result.ok) values[field.key] = result.value; else errors.push(`${field.label}: ${result.error}`);
    }
    if (rowSchema && errors.length === 0) {
      const parsed = rowSchema.safeParse(values);
      if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => issue.message));
    }
    return errors.length ? { ok: false, errors } : { ok: true, values };
  });
}
