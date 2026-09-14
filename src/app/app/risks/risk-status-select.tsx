"use client";

import { updateRiskStatusAction } from "../actions";

export function RiskStatusSelect({ id, status, title }: { id: string; status: string; title?: string }) {
  return <form action={updateRiskStatusAction}><input type="hidden" name="id" value={id} /><select aria-label={title ? `Status for ${title}` : "Risk status"} name="status" className="field" defaultValue={status} onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></form>;
}
