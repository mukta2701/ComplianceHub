import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill, Progress } from "@/components/ui";
import {
  COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_LABEL,
  summariseFrameworkCoverage,
  type ComplianceFramework,
  type CrosswalkMapping,
} from "@/features/controls/domain/crosswalk";
import { addControlCrosswalkAction, deleteControlCrosswalkAction } from "./actions";

// A control counts as "implemented" when its Statement of Applicability status
// is in the mature tier (established/operational/advanced) — the same maturity
// semantics the readiness weighting treats as substantially in place.
const IMPLEMENTED_SOA_STATUSES = new Set(["established", "operational", "advanced"]);

export default async function FrameworksPage() {
  const { supabase } = await requireAppContext();
  const [{ data: controls }, { data: crosswalks }, { data: soaItems }, { data: mappings }] = await Promise.all([
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("control_crosswalks").select("id,control_id,framework,external_ref,note,created_at").order("created_at"),
    // RLS scopes SoA items to the organisation. A catalogue control is treated
    // as implemented if any of the org's SoA items for it is in the mature tier.
    supabase.from("soa_items").select("control_id,status"),
    // Global 1:1 bridge from the SoA catalogue control (requirement_id) to the
    // shared control library id used by the crosswalk.
    supabase.from("requirement_control_mappings").select("requirement_id,control_id"),
  ]);

  const controlById = new Map((controls ?? []).map((c) => [c.id, c]));
  // requirement (catalogue) id -> shared control library id.
  const libraryByRequirement = new Map((mappings ?? []).map((m) => [m.requirement_id, m.control_id]));
  const implementedControlIds = new Set<string>();
  for (const item of soaItems ?? []) {
    if (IMPLEMENTED_SOA_STATUSES.has(item.status)) {
      const libraryId = libraryByRequirement.get(item.control_id);
      if (libraryId) implementedControlIds.add(libraryId);
    }
  }

  const crosswalkRows = crosswalks ?? [];
  const coverageInput: CrosswalkMapping[] = crosswalkRows.map((row) => ({
    framework: row.framework as ComplianceFramework,
    controlId: row.control_id,
    externalRef: row.external_ref,
  }));
  const coverage = summariseFrameworkCoverage(coverageInput, implementedControlIds);

  return <>
    <PageIntro
      eyebrow="FRAMEWORKS"
      title="Framework crosswalk"
      body="Record how your ISO 27001 controls map to other frameworks' requirements. These are your organisation's own mappings — a requirement counts as covered once a mapped control is marked implemented in your Statement of Applicability, so overlapping requirements reuse the evidence you have already attached."
    />

    <section aria-label="Per-framework coverage" style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", marginBottom: "24px" }}>
      {coverage.map((row) => (
        <Card key={row.framework} style={{ padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <b style={{ fontSize: "14px" }}>{COMPLIANCE_FRAMEWORK_LABEL[row.framework]}</b>
            <Pill tone={row.mappedRequirements === 0 ? "blue" : row.percent === 100 ? "green" : row.percent > 0 ? "amber" : "red"}>{row.percent}%</Pill>
          </div>
          <div style={{ margin: "10px 0 8px" }}><Progress value={row.percent} tone={row.percent === 100 ? "green" : row.percent > 0 ? "amber" : "blue"} /></div>
          <small style={{ color: "#596273" }}>
            {row.mappedRequirements === 0
              ? "No requirements mapped yet"
              : `${row.coveredByImplementedControl} of ${row.mappedRequirements} mapped requirement${row.mappedRequirements === 1 ? "" : "s"} covered by an implemented control`}
          </small>
        </Card>
      ))}
    </section>

    <h2 style={{ fontSize: "16px", margin: "0 0 12px" }}>Your mappings</h2>
    {crosswalkRows.length === 0 ? (
      <EmptyState icon="file" title="Record your first crosswalk mapping" body="Map one of your ISO 27001 controls to another framework's requirement (for example control CH-001 to SOC 2 CC6.1). You own these mappings — ComplianceHub does not assert cross-framework equivalence for you." />
    ) : (
      <Card style={{ padding: 0, marginBottom: "24px" }}><div className="data-table-wrap" role="region" aria-label="Control crosswalk mappings" tabIndex={0}><table>
        <thead><tr><th>ISO 27001 control</th><th>Framework</th><th>Requirement</th><th>Note</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {crosswalkRows.map((row) => {
            const control = controlById.get(row.control_id);
            return <tr key={row.id}>
              <td><b>{control?.code ?? "—"}</b>{control ? `: ${control.title}` : ""}</td>
              <td><Pill tone="blue">{COMPLIANCE_FRAMEWORK_LABEL[row.framework as ComplianceFramework]}</Pill></td>
              <td>{row.external_ref}</td>
              <td>{row.note || "—"}</td>
              <td style={{ textAlign: "right" }}>
                <form action={deleteControlCrosswalkAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button className="button secondary" aria-label={`Remove mapping of ${control?.code ?? "control"} to ${COMPLIANCE_FRAMEWORK_LABEL[row.framework as ComplianceFramework]} ${row.external_ref}`}>Remove</button>
                </form>
              </td>
            </tr>;
          })}
        </tbody>
      </table></div></Card>
    )}

    <Card id="add-mapping" style={{ padding: "18px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add a mapping</h2>
      <form action={addControlCrosswalkAction} className="app-form">
        <div className="form-grid">
          <label>ISO 27001 control<select name="controlId" required defaultValue="">
            <option value="" disabled>Select a control</option>
            {(controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}
          </select></label>
          <label>Framework<select name="framework" defaultValue="soc_2">
            {COMPLIANCE_FRAMEWORKS.map((f) => <option key={f} value={f}>{COMPLIANCE_FRAMEWORK_LABEL[f]}</option>)}
          </select></label>
          <label>Requirement reference<input name="externalRef" required maxLength={80} placeholder="e.g. CC6.1" /></label>
        </div>
        <label>Note<textarea name="note" maxLength={500} placeholder="How your control satisfies this requirement (your own interpretation)." /></label>
        <button className="button primary">Add mapping</button>
      </form>
    </Card>
  </>;
}
