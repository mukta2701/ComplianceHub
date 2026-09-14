import { Card } from "@/components/ui";
import { revokeOAuthGrantAction } from "./oauth-actions";

type Grant = { clientId: string; clientName: string; scopes: string[]; grantedAt: string };
export function ConnectedApplications({ state }: { state: { status: "loaded" | "error"; grants: Grant[] } }) {
  return <Card id="connected-apps">
    <div className="settings-head">
      <h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>MCP &amp; connected assistants</h2>
      <p>Codex and Claude can use ComplianceHub&rsquo;s read-only MCP tools under your workspace permissions. This access is separate from optional Explain &amp; Act drafting. Revoking access ends active sessions and refresh access.</p>
    </div>
    {state.status === "error" && <p role="alert" style={{ padding: "12px 20px" }}>Connected assistants are temporarily unavailable. Refresh this page to try again.</p>}
    <div className="team-list">
      {state.grants.map((grant) => <div key={grant.clientId}>
        <div style={{ flex: 1 }}>
          <b>{grant.clientName}</b>
          <small style={{ display: "block" }}>Read-only MCP access · Connected {new Date(grant.grantedAt).toLocaleDateString("en-GB")}</small>
          <details>
            <summary>Technical permissions</summary>
            <small>{grant.scopes.join(", ") || "No OAuth scopes recorded."}</small>
          </details>
        </div>
        <form action={revokeOAuthGrantAction}><input type="hidden" name="clientId" value={grant.clientId} /><button className="button secondary">Revoke</button></form>
      </div>)}
      {state.status === "loaded" && !state.grants.length && <div><span><b>No connected assistants.</b><small>Approved Codex or Claude MCP connections will appear here.</small></span></div>}
    </div>
  </Card>;
}
