import { Card, Pill } from "@/components/ui";
import { updateAiOptInAction } from "./ai-actions";

export function AiWorkspaceSettings({ enabled, isOwner }: { enabled: boolean; isOwner: boolean }) {
  return <Card id="ai-assistance">
    <div className="settings-head">
      <h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Explain &amp; Act assistance</h2>
      <p>Optional, server-side drafting for remediation explanations. AI output is a draft only; a human must review every decision.</p>
    </div>
    <div className="security-row">
      <span><b>Workspace assistance</b><small>{enabled ? "Enabled for this workspace." : "Disabled until an owner opts in."} Provider credentials remain server-only.</small></span>
      <Pill tone={enabled ? "green" : "neutral"}>{enabled ? "Enabled" : "Disabled"}</Pill>
      {isOwner && <form action={updateAiOptInAction}>
        <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
        <button className="button secondary" type="submit">{enabled ? "Disable AI assistance" : "Enable AI assistance"}</button>
      </form>}
      {!isOwner && <small>Enabled by a workspace owner</small>}
    </div>
  </Card>;
}
