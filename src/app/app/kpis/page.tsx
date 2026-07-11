import { requireAppContext } from "@/lib/app-context";
import { MEASUREMENT_TYPE_LABEL, MEASUREMENT_TYPE_TONE, needsReview, type MeasurementType } from "@/features/kpis/domain/kpis";
import { summariseMeasurements, type MeasurementReading } from "@/features/kpis/domain/measurements";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { createKpiAction, raiseKpiTaskAction, recordKpiMeasurementAction } from "./actions";

const DIRECTION_ROTATION: Record<"up" | "down" | "flat", string> = { up: "rotate(-90deg)", down: "rotate(90deg)", flat: "rotate(0deg)" };

// Inline trend sparkline for a KPI's recorded readings (chronological).
function Sparkline({ readings }: { readings: MeasurementReading[] }) {
  if (readings.length < 2) return null;
  const W = 92, H = 28, pad = 3;
  const values = readings.map((r) => r.value);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = readings.map((r, i) => {
    const x = pad + (i / (readings.length - 1)) * (W - 2 * pad);
    const y = H - pad - ((r.value - min) / span) * (H - 2 * pad);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad.toFixed(1)},${(H - pad).toFixed(1)} ${line} ${(W - pad).toFixed(1)},${(H - pad).toFixed(1)}`;
  const [ex, ey] = points[points.length - 1];
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="sparkline" role="img" aria-label={`Trend of ${readings.length} readings`}>
    <polygon points={area} className="spark-area" />
    <polyline points={line} className="spark-line" />
    <circle cx={ex} cy={ey} r={2.4} className="spark-dot" />
  </svg>;
}

export default async function KpisPage() {
  const { supabase } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: kpis }, { data: members }, { data: measurements }] = await Promise.all([
    supabase.from("kpis").select("id,control_function,indicator,measurement_type,threshold,observations,next_steps,last_reviewed,task_id").order("indicator"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("kpi_measurements").select("kpi_id,value,measured_on").order("measured_on"),
  ]);
  const rows = kpis ?? [];
  const readingsByKpi = new Map<string, MeasurementReading[]>();
  for (const m of measurements ?? []) {
    const list = readingsByKpi.get(m.kpi_id) ?? [];
    list.push({ value: Number(m.value), measured_on: m.measured_on });
    readingsByKpi.set(m.kpi_id, list);
  }
  return <>
    <PageIntro eyebrow="MANAGEMENT REVIEW" title="Performance measures" body="The KPIs your management review discusses — indicator, measurement type, target, the trend of recorded readings, and the next steps that become tasks." />
    {rows.length > 0 && (
    <Card style={{ padding: 0, marginBottom: "16px" }}><div className="data-table-wrap" role="region" aria-label="KPI register" tabIndex={0}><table>
      <thead><tr><th>Function</th><th>Indicator</th><th>Type</th><th>Target</th><th>Reviewed</th><th>Trend</th><th>Next steps</th></tr></thead>
      <tbody>
        {rows.map((k) => {
          const readings = readingsByKpi.get(k.id) ?? [];
          const trend = summariseMeasurements(readings);
          return <tr key={k.id}>
          <td>{k.control_function || "—"}</td>
          <td><b>{k.indicator}</b></td>
          <td><Pill tone={MEASUREMENT_TYPE_TONE[k.measurement_type as MeasurementType]}>{MEASUREMENT_TYPE_LABEL[k.measurement_type as MeasurementType]}</Pill></td>
          <td>{k.threshold || "—"}</td>
          <td>{needsReview(k.last_reviewed, today) ? <Pill tone="amber">Needs review</Pill> : k.last_reviewed}</td>
          <td>
            {trend.latest === null ? <small style={{ color: "#596273" }}>No readings yet</small> : <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkline readings={readings} />
              <b>{trend.latest}</b>
              {trend.direction && trend.delta !== null && <Pill tone="blue">
                <span aria-hidden="true" style={{ display: "inline-flex", transform: DIRECTION_ROTATION[trend.direction] }}><Icon name="arrow" /></span>
                {" "}{trend.delta > 0 ? "+" : ""}{trend.delta}
              </Pill>}
            </div>}
            <form action={recordKpiMeasurementAction} style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <input type="hidden" name="kpiId" value={k.id} />
              <label style={{ display: "flex", flexDirection: "column", fontSize: "11px", gap: "2px" }}>Value<input name="value" type="number" step="any" required aria-label={`Measurement value for ${k.indicator}`} style={{ width: "84px" }} /></label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "11px", gap: "2px" }}>Date<input name="measuredOn" type="date" aria-label={`Measurement date for ${k.indicator}`} /></label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "11px", gap: "2px" }}>Note<input name="note" maxLength={500} aria-label={`Measurement note for ${k.indicator}`} style={{ width: "120px" }} /></label>
              <button className="button secondary">Record</button>
            </form>
          </td>
          <td>{k.next_steps || "—"}{k.next_steps && !k.task_id && <form action={raiseKpiTaskAction} style={{ marginTop: "6px", display: "flex", gap: "6px" }}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="indicator" value={k.indicator} /><input type="hidden" name="nextSteps" value={k.next_steps} /><select name="ownerId" className="field" defaultValue="" aria-label={`Task owner for ${k.indicator}`}><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select><button className="button secondary">Raise task</button></form>}{k.task_id && <small style={{ display: "block", color: "#596273" }}>Task raised.</small>}</td>
        </tr>;
        })}
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
          <label>Responsible party<select name="responsibleId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Last reviewed<input name="lastReviewed" type="date" /></label>
        </div>
        <label>Observations<textarea name="observations" maxLength={10000} /></label>
        <label>Next steps<textarea name="nextSteps" maxLength={10000} /></label>
        <button className="button primary">Add KPI</button>
      </form>
    </Card>
  </>;
}
