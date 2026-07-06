"use client";

import { updateRiskStatusAction } from "../actions";

// Client component: the register's status selector auto-submits on change, which
// needs an event handler. Server Components cannot pass event handlers to the
// DOM, so this thin wrapper keeps that interactivity on the client.
export function RiskStatusSelect({ id, status }: { id: string; status: string }) {
  return <form action={updateRiskStatusAction}><input type="hidden" name="id" value={id} /><select name="status" className="field" defaultValue={status} onChange={(e) => e.currentTarget.form?.requestSubmit()}><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></form>;
}
