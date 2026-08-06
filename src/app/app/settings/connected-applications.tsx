import { Card } from "@/components/ui";
import { revokeOAuthGrantAction } from "./oauth-actions";

type Grant = { clientId: string; clientName: string; scopes: string[]; grantedAt: string };
export function ConnectedApplications({ state }: { state: { status: "loaded" | "error"; grants: Grant[] } }) {
  return <Card id="connected-apps">
    <div className="settings-head"><h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Connected AI applications</h2><p>Applications you personally authorized. Revoking one invalidates its sessions and refresh tokens.</p></div>
    {state.status === "error" && <p role="alert" style={{ padding: "12px 20px" }}>Connected applications are temporarily unavailable. Refresh this page to try again.</p>}
    <div className="team-list">
      {state.grants.map((grant) => <div key={grant.clientId}><span><b>{grant.clientName}</b><small>{grant.scopes.join(", ") || "Identity access"} · Connected {new Date(grant.grantedAt).toLocaleDateString("en-GB")}</small></span><form action={revokeOAuthGrantAction}><input type="hidden" name="clientId" value={grant.clientId} /><button className="button secondary">Revoke</button></form></div>)}
      {state.status === "loaded" && !state.grants.length && <div><span><b>No connected AI applications.</b><small>Approved Codex or Claude connections will appear here.</small></span></div>}
    </div>
  </Card>;
}
