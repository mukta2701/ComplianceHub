"use client";

import { useState } from "react";
import { raiseFindingAction } from "../actions";

export function AuditFindingForm({ auditId, members, checklistItems = [] }: { auditId:string;members:{ id:string;label:string }[];checklistItems?:{ id:string;label:string }[] }) {
  const [spawnTask, setSpawnTask] = useState(false);
  return <form action={raiseFindingAction} className="app-form">
    <input type="hidden" name="auditId" value={auditId} />
    <label>Summary<input name="summary" required maxLength={2000} /></label>
    <label>Checklist item<select name="checklistItemId" defaultValue=""><option value="">Audit-wide finding</option>{checklistItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="form-grid">
      <label>Severity<select name="severity" defaultValue="observation"><option value="observation">Observation</option><option value="minor_nc">Minor non-conformity</option><option value="major_nc">Major non-conformity</option></select></label>
      <label>Owner (for the task)<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label>
      <label>Due date<input name="dueOn" type="date" /></label>
    </div>
    <label>Corrective action {spawnTask && <small>(required for a task)</small>}<textarea name="correctiveAction" required={spawnTask} maxLength={10000} /></label>
    <label className="check-row"><input type="checkbox" name="spawnTask" checked={spawnTask} onChange={(event) => setSpawnTask(event.target.checked)} />Raise a corrective-action task from this finding</label>
    <button className="button primary">Raise finding</button>
  </form>;
}
