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

export function dateField(key: string, label: string, required: boolean, aliases: string[]): TargetField {
  return { key, label, required, aliases, coerce: (raw) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (iso) return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}` };
    const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim());
    if (uk) { const y = uk[3].length === 2 ? `20${uk[3]}` : uk[3]; return { ok: true, value: `${y}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}` }; }
    return { ok: false, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" };
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
