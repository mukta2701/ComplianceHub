import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import {
  annotateCrosswalkCoverage,
  COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_LABEL,
  summariseFrameworkCoverage,
  type ComplianceFramework,
  type CrosswalkMapping,
} from "@/features/controls/domain/crosswalk";
import { hasCapability } from "@/features/organisations/domain/access";
import { addControlCrosswalkAction, deleteControlCrosswalkAction } from "./actions";

// A control counts as "implemented" when its Statement of Applicability status
// is in the mature tier (established/operational/advanced) — the same maturity
// semantics the readiness weighting treats as substantially in place.
const IMPLEMENTED_SOA_STATUSES = new Set(["established", "operational", "advanced"]);

export default async function FrameworksPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const canManage = hasCapability(membership.role, "manage_frameworks");

  // Coverage is a view of the active workspace's current SoA, not a lifetime
  // history. Version ordering matches the readiness-report loader semantics.
  const registerResult = await supabase
    .from("soa_registers")
    .select("id")
    .eq("organisation_id", organisation.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (registerResult.error) throw new Error("Could not load framework coverage");
  const latestRegister = registerResult.data;

  const [controlsResult, crosswalksResult, soaItemsResult, mappingsResult] = await Promise.all([
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("control_crosswalks")
      .select("id,control_id,framework,external_ref,note,created_at")
      .eq("organisation_id", organisation.id)
      .order("created_at"),
    latestRegister
      ? supabase.from("soa_items")
          .select("control_id,status")
          .eq("organisation_id", organisation.id)
          .eq("soa_register_id", latestRegister.id)
      : Promise.resolve({ data: [] as Array<{ control_id: string; status: string }>, error: null }),
    // Global 1:1 bridge from the SoA catalogue control (requirement_id) to the
    // shared control library id used by the crosswalk.
    supabase.from("requirement_control_mappings").select("requirement_id,control_id"),
  ]);
  if ([controlsResult, crosswalksResult, soaItemsResult, mappingsResult].some((result) => result.error)) {
    throw new Error("Could not load framework coverage");
  }
  const controls = controlsResult.data;
  const crosswalks = crosswalksResult.data;
  const soaItems = soaItemsResult.data;
  const mappings = mappingsResult.data;

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
  const mappingCoverage = annotateCrosswalkCoverage(coverageInput, implementedControlIds);

  return <>
    <PageIntro
      eyebrow="FRAMEWORKS"
      title="Framework coverage from your Statement of Applicability"
      body="A mapping links one shared ISO 27001 control to one published requirement reference in another framework. It lets your organisation reuse recorded work and evidence; the ISO control's current SoA implementation status determines whether that recorded requirement is shown as covered."
    />
    <SubTabs tabs={canManage
      ? [{ href: "/app/soa", label: "Statement of Applicability" }, { href: "/app/frameworks", label: "Framework coverage" }]
      : [{ href: "/app/frameworks", label: "Framework coverage" }]} />

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 12px" }}>How recorded coverage works</h2>
      <ol aria-label="How recorded coverage works" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px", margin: 0, padding: 0, listStyle: "none" }}>
        <li style={{ background: "#f7f9fc", borderRadius: "10px", padding: "13px" }}><b>1. Record a mapping</b><span style={{ display: "block", marginTop: "5px", color: "#596273", fontSize: "12px" }}>Choose an ISO control, a target framework and published requirement reference, then record your rationale.</span></li>
        <li style={{ background: "#f7f9fc", borderRadius: "10px", padding: "13px" }}><b>2. Implement the ISO control</b><span style={{ display: "block", marginTop: "5px", color: "#596273", fontSize: "12px" }}>Established, Operational and Advanced SoA statuses count as mature implementation.</span></li>
        <li style={{ background: "#f7f9fc", borderRadius: "10px", padding: "13px" }}><b>3. Reuse recorded work</b><span style={{ display: "block", marginTop: "5px", color: "#596273", fontSize: "12px" }}>If any ISO control mapped to the same requirement is mature, that recorded requirement shows Covered.</span></li>
      </ol>
    </Card>

    <p role="note" style={{ background: "#fff8e8", border: "1px solid #f0ddb0", borderRadius: "10px", color: "#66552e", fontSize: "12px", lineHeight: 1.55, margin: "0 0 16px", padding: "12px 14px" }}>
      These figures measure only the requirements your organisation has recorded below. They are not total framework compliance, certification, legal advice, or audit assurance. Verify each published reference and interpretation with your own qualified reviewers.
    </p>

    <section aria-label="Per-framework coverage" style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", marginBottom: "24px" }}>
      {coverage.map((row) => (
        <Card key={row.framework} style={{ padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <b style={{ fontSize: "14px" }}>{COMPLIANCE_FRAMEWORK_LABEL[row.framework]}</b>
            <Pill tone="neutral">{row.mappedRequirements === 0 ? "No data" : `${row.coveredByImplementedControl}/${row.mappedRequirements} recorded`}</Pill>
          </div>
          {row.mappedRequirements > 0 && <div style={{ margin: "10px 0 8px" }}><Progress value={row.percent} tone="blue" label={`${COMPLIANCE_FRAMEWORK_LABEL[row.framework]} recorded mapping coverage`} /></div>}
          <small style={{ color: "#596273" }}>
            {row.mappedRequirements === 0
              ? "No recorded mappings yet"
              : row.coveredByImplementedControl === row.mappedRequirements
                ? `All ${row.mappedRequirements} recorded requirement${row.mappedRequirements === 1 ? "" : "s"} covered`
                : `${row.coveredByImplementedControl} of ${row.mappedRequirements} recorded requirement${row.mappedRequirements === 1 ? "" : "s"} covered`}
          </small>
        </Card>
      ))}
    </section>

    <h2 style={{ fontSize: "16px", margin: "0 0 12px" }}>Recorded mappings</h2>
    {crosswalkRows.length > 0 ?
      <Card style={{ padding: 0, marginBottom: "24px" }}><div className="data-table-wrap" role="region" aria-label="Recorded framework mappings" tabIndex={0}><table aria-label="Recorded framework mappings">
        <thead><tr><th>Source ISO control</th><th>Target framework</th><th>Published requirement</th><th>Rationale / interpretation</th><th>Recorded coverage</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>
          {crosswalkRows.map((row, index) => {
            const control = controlById.get(row.control_id);
            const covered = mappingCoverage[index]?.covered ?? false;
            return <tr key={row.id}>
              <td><b>{control?.code ?? "—"}</b>{control ? `: ${control.title}` : ""}</td>
              <td><Pill tone="blue">{COMPLIANCE_FRAMEWORK_LABEL[row.framework as ComplianceFramework]}</Pill></td>
              <td>{row.external_ref}</td>
              <td>{row.note || <span style={{ color: "#596273", fontStyle: "italic" }}>No rationale recorded (legacy mapping)</span>}</td>
              <td><Pill tone={covered ? "green" : "amber"}>{covered ? "Covered" : "Not yet covered"}</Pill><small>{covered
                ? "At least one ISO control mapped to this requirement has an Established, Operational or Advanced SoA status."
                : "This changes to Covered when any ISO control mapped to this requirement reaches Established, Operational or Advanced in the SoA."}</small></td>
              {canManage && <td style={{ textAlign: "right" }}>
                <form action={deleteControlCrosswalkAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button className="button secondary" aria-label={`Remove mapping of ${control?.code ?? "control"} to ${COMPLIANCE_FRAMEWORK_LABEL[row.framework as ComplianceFramework]} ${row.external_ref}`}>Remove</button>
                </form>
              </td>}
            </tr>;
          })}
        </tbody>
      </table></div></Card>
      : <Card style={{ padding: "18px", marginBottom: "24px" }}><p style={{ margin: 0, color: "#596273", fontSize: "13px" }}>No mappings have been recorded for this workspace. Coverage will appear only after an operator records and reviews a mapping.</p></Card>}

    {canManage && <Card id="add-mapping" style={{ padding: "18px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add a mapping</h2>
      <p style={{ color: "#596273", fontSize: "12px", margin: "0 0 4px" }}>Record your organisation&apos;s reviewed interpretation. ComplianceHub does not supply or endorse authoritative cross-framework mappings.</p>
      <form action={addControlCrosswalkAction} className="app-form" aria-label="Add a framework mapping">
        <div className="form-grid">
          <label>Source ISO control<select name="controlId" required defaultValue="">
            <option value="" disabled>Select a control</option>
            {(controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}
          </select></label>
          <label>Target framework<select name="framework" required defaultValue="soc_2">
            {COMPLIANCE_FRAMEWORKS.map((f) => <option key={f} value={f}>{COMPLIANCE_FRAMEWORK_LABEL[f]}</option>)}
          </select></label>
          <label>Published requirement reference<input name="externalRef" required maxLength={80} placeholder="e.g. CC6.1" /></label>
        </div>
        <label>Required rationale / interpretation<textarea name="note" required maxLength={500} placeholder="Explain why your organisation believes this ISO control supports the published requirement." /></label>
        <button className="button primary">Add mapping</button>
      </form>
    </Card>}
  </>;
}
