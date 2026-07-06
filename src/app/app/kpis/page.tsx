import { requireAppContext } from "@/lib/app-context";
import { MEASUREMENT_TYPE_LABEL, MEASUREMENT_TYPE_TONE, needsReview, type MeasurementType } from "@/features/kpis/domain/kpis";
import { Card, EmptyState, PageIntro, Pill } from "@/components/ui";
import { createKpiAction, raiseKpiTaskAction } from "./actions";

export default async function KpisPage() {
  const { supabase } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: kpis }, { data: members }] = await Promise.all([
    supabase.from("kpis").select("id,control_function,indicator,measurement_type,threshold,observations,next_steps,last_reviewed,task_id").order("indicator"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const rows = kpis ?? [];
  return <>
    <PageIntro eyebrow="MANAGEMENT REVIEW" title="Performance measures" body="The KPIs your management review discusses — indicator, measurement type, target, and the next steps that become tasks." />
    {!rows.length ? (
      <EmptyState icon="check" title="Add your first KPI" body="Track the performance measures your management review discusses — indicator, measurement type, target, and the next steps that become owned tasks. Add your first measure below." primary={{ href: "#add-kpi", label: "Add your first KPI" }} />
    ) : (
    <Card style={{ padding: 0, marginBottom: "16px" }}><div className="data-table-wrap" role="region" aria-label="KPI register" tabIndex={0}><table>
      <thead><tr><th>Function</th><th>Indicator</th><th>Type</th><th>Target</th><th>Reviewed</th><th>Next steps</th></tr></thead>
      <tbody>
        {rows.map((k) => <tr key={k.id}>
          <td>{k.control_function || "—"}</td>
          <td><b>{k.indicator}</b></td>
          <td><Pill tone={MEASUREMENT_TYPE_TONE[k.measurement_type as MeasurementType]}>{MEASUREMENT_TYPE_LABEL[k.measurement_type as MeasurementType]}</Pill></td>
          <td>{k.threshold || "—"}</td>
          <td>{needsReview(k.last_reviewed, today) ? <Pill tone="amber">Needs review</Pill> : k.last_reviewed}</td>
          <td>{k.next_steps || "—"}{k.next_steps && !k.task_id && <form action={raiseKpiTaskAction} style={{ marginTop: "6px", display: "flex", gap: "6px" }}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="indicator" value={k.indicator} /><input type="hidden" name="nextSteps" value={k.next_steps} /><select name="ownerId" className="field" defaultValue="" aria-label={`Task owner for ${k.indicator}`}><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select><button className="button secondary">Raise task</button></form>}{k.task_id && <small style={{ display: "block", color: "#596273" }}>Task raised.</small>}</td>
        </tr>)}
      </tbody>
    </table></div></Card>
    )}
    <Card id="add-kpi" style={{ padding: "18px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add a KPI</h2>
      <form action={createKpiAction} className="app-form">
        <div className="form-grid">
          <label>Control / function<input name="controlFunction" maxLength={200} /></label>
          <label>Indicator<input name="indicator" required maxLength={300} /></label>
          <label>Measurement type<select name="measurementType" defaultValue="manual"><option value="automatic">Automatic</option><option value="manual">Manual</option><option value="external">External</option></select></label>
          <label>Target / threshold<input name="threshold" maxLength={500} /></label>
          <label>Responsible party<select name="responsibleId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Last reviewed<input name="lastReviewed" type="date" /></label>
        </div>
        <label>Observations<textarea name="observations" maxLength={10000} /></label>
        <label>Next steps<textarea name="nextSteps" maxLength={10000} /></label>
        <button className="button primary">Add KPI</button>
      </form>
    </Card>
  </>;
}
