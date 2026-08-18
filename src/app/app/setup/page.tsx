import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { automationProviderDetails } from "@/features/automation/application/setup";
import { saveAutomationSetupAction } from "./actions";

const providers = ["google_workspace", "github", "aws", "jira", "linear"] as const;
const areas = [
  ["identityOwnerId", "Identity owner", "Reviews access, MFA and Workspace evidence."],
  ["engineeringOwnerId", "Engineering owner", "Reviews repository protection and software delivery evidence."],
  ["cloudOwnerId", "Cloud owner", "Reviews cloud posture and Security Hub findings."],
  ["complianceOwnerId", "Compliance owner", "Reviews policy, audit and work-tracking evidence."],
] as const;

export default async function AutomationSetupPage() {
  const { supabase, user, membership, organisation } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id);
  const isOwner = membership.role === "owner";
  return <>
    <PageIntro eyebrow="AUTOMATION SETUP" title="Connect the systems that already know your work" body="ComplianceHub will collect bounded evidence and prepare reviewable drafts. It will never mark you compliant or make a final GRC decision." />
    {!isOwner && <Card role="note" style={{ padding: "18px" }}>Only a workspace owner can choose sources and assign automation owners.</Card>}
    {isOwner && <form action={saveAutomationSetupAction} className="app-form">
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "16px", margin: "0 0 6px" }}>Choose your systems</h2>
        <p style={{ color: "#596273", fontSize: "13px", margin: "0 0 16px" }}>Start with the tools that produce the most useful security evidence. You can skip any system and return later.</p>
        <div style={{ display: "grid", gap: "10px" }}>
          {providers.map((provider) => { const detail = automationProviderDetails[provider]; return <label key={provider} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "12px", alignItems: "start", padding: "14px", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
            <input name="providers" type="checkbox" value={provider} defaultChecked={["google_workspace", "github", "aws"].includes(provider)} style={{ marginTop: "3px" }} />
            <span><b style={{ fontSize: "14px" }}>{detail.label}</b><small style={{ display: "block", color: "#596273", marginTop: "4px", fontSize: "12px", lineHeight: 1.45 }}>Reads {detail.reads}. Unaccepted content is purged after 30 days.</small></span>
            <Pill tone="blue">{detail.area}</Pill>
          </label>; })}
        </div>
      </Card>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "16px", margin: "0 0 6px" }}>Assign the review owners</h2>
        <p style={{ color: "#596273", fontSize: "13px", margin: "0 0 16px" }}>Automation goes to the people closest to the work. The workspace owner can change assignments later.</p>
        <div className="form-grid">{areas.map(([name, label, help]) => <label key={name}>{label}<select name={name} defaultValue={user.id}>{members?.map((member) => { const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles; return <option key={member.user_id} value={member.user_id}>{profile?.display_name ?? member.user_id}</option>; })}</select><small style={{ color: "#596273", display: "block", marginTop: "4px" }}>{help}</small></label>)}</div>
      </Card>
      <Card style={{ padding: "18px", borderColor: "#cfe0fb", background: "#fbfdff" }}>
        <b style={{ fontSize: "13px" }}>What happens next</b><p style={{ margin: "6px 0 14px", color: "#596273", fontSize: "13px", lineHeight: 1.5 }}>ComplianceHub prepares sandbox collection for Google Workspace, GitHub and AWS, then generates a baseline with confirmed facts and reviewable gaps. Live access is configured from Integrations when you are ready.</p>
        <button className="button primary">Save setup and open Automation</button>
      </Card>
    </form>}
  </>;
}
