"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { ImportModule } from "@/features/imports/adapters";
import { analyseImportAction, runImportAction, type AnalyseResult, type ImportRunResult } from "./actions";

type FieldDescriptor = { key: string; label: string; required: boolean };

export function ImportWizard({ module, fields, recordsHref, recordsLabel, registers }: { module: ImportModule; fields: FieldDescriptor[]; recordsHref: string; recordsLabel: string; registers?: { id: string; title: string }[] }) {
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [registerId, setRegisterId] = useState<string>(registers?.[0]?.id ?? "");
  const [preview, setPreview] = useState<ImportRunResult | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function analyse(formData: FormData) {
    setError(null); setPreview(null); setResult(null);
    const res: AnalyseResult = await analyseImportAction(formData);
    if ("error" in res) { setError(res.error); return; }
    setHeaders(res.headers); setRows(res.rows); setMapping(res.suggestion);
  }
  function run(commit: boolean) {
    if (!headers) return;
    start(async () => {
      const res = await runImportAction({ module, headers, rows, mapping, commit, registerId: registerId || undefined });
      if (commit) setResult(res); else setPreview(res);
    });
  }

  const noun = module === "soa" ? "control update" : "row";
  return <>
    <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>1. Upload your workbook</h2>
      <form action={(fd) => start(async () => analyse(fd))} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="module" value={module} />
        {registers && registers.length > 0 && <label style={{ fontSize: "13px", fontWeight: 700 }}>Register<select value={registerId} onChange={(e) => setRegisterId(e.target.value)} style={{ display: "block" }} aria-label="Target SoA register">{registers.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
        <input name="file" type="file" accept=".xlsx,.csv" required aria-label="Workbook file (XLSX or CSV)" />
        <button className="button primary" disabled={pending}>Analyse file</button>
      </form>
      {error && <p role="alert" style={{ color: "var(--red)", fontSize: "13px", marginTop: "10px" }}>{error}</p>}
    </Card>

    {headers && <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>2. Map columns</h2>
      <div className="data-table-wrap" role="region" aria-label="Column mapping" tabIndex={0}>
        <table><thead><tr><th>File column</th><th>Maps to</th></tr></thead><tbody>
          {headers.map((h) => <tr key={h}><td>{h}</td><td>
            <select aria-label={`Map column ${h}`} value={mapping[h] ?? ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
              <option value="">Ignore this column</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
            </select>
          </td></tr>)}
        </tbody></table>
      </div>
      <button className="button secondary" style={{ marginTop: "12px" }} disabled={pending} onClick={() => run(false)}>Preview {rows.length} {noun}{rows.length === 1 ? "" : "s"}</button>
    </Card>}

    {preview && <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>3. Preview &amp; validation</h2>
      <p style={{ fontSize: "13px", margin: "0 0 10px" }}>{preview.valid} valid, {preview.invalid} with errors. {module === "soa" ? `${preview.updated} matched controls will be updated.` : `${preview.valid} rows will be added.`}</p>
      {preview.rowErrors.length > 0 && <ul style={{ fontSize: "12px", color: "var(--red)", margin: "0 0 10px", paddingLeft: "18px" }}>{preview.rowErrors.slice(0, 50).map((e) => <li key={e.row}>Row {e.row}: {e.errors.join("; ")}</li>)}</ul>}
      {preview.valid > 0 && <form action={() => run(true)}><button className="button primary" disabled={pending}>4. Confirm import ({module === "soa" ? preview.updated : preview.valid})</button></form>}
    </Card>}

    {result && <Card style={{ padding: "22px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 6px" }}>Import complete</h2>
      <p style={{ fontSize: "13px", margin: "0 0 6px" }}>{module === "soa" ? `${result.updated} controls updated` : `${result.imported} rows added`}{result.skipped ? `, ${result.skipped} skipped` : ""}.</p>
      {result.notes.length > 0 && <ul style={{ fontSize: "12px", color: "#596273", margin: "0 0 10px", paddingLeft: "18px" }}>{result.notes.slice(0, 50).map((note, i) => <li key={i}>{note}</li>)}</ul>}
      <Link className="button secondary" href={recordsHref}>View {recordsLabel}</Link>
    </Card>}
  </>;
}
