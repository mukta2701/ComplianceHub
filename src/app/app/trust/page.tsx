import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { saveTrustCenterAction, disableTrustCenterAction } from "./actions";

export default async function TrustCenterSettingsPage() {
  const { supabase, membership, organisation } = await requireAppContext();
  const isOwner = membership.role === "owner";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Owner-only RLS means a non-owner reads no row; guard the query accordingly.
  const { data: settings } = isOwner
    ? await supabase.from("trust_center_settings").select("enabled,slug,show_policy_titles,headline,updated_at").eq("organisation_id", organisation.id).maybeSingle()
    : { data: null };

  return <>
    <PageIntro eyebrow="TRUST CENTER" title="Public Trust Center" body="Publish a read-only, public page that shares your security posture with prospects and customers. It is off by default and shows only safe summary data — never risks, findings, evidence or policy contents." />

    {!isOwner && <Card style={{ padding: "18px" }} role="note"><p>Only workspace owners can manage the Trust Center.</p></Card>}

    {isOwner && <>
      {settings?.enabled && settings.slug && <Card style={{ padding: "18px", marginBottom: "16px", background: "#eef7f0", borderColor: "#cfe6d5" }} role="status">
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <h2 style={{ fontSize: "15px", margin: 0 }}>Your Trust Center is live</h2>
          <Pill tone="green">Public</Pill>
        </div>
        <p style={{ margin: 0, fontSize: "13px", wordBreak: "break-all" }}>{site}/trust/{settings.slug}</p>
      </Card>}

      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>{settings ? "Update your Trust Center" : "Set up your Trust Center"}</h2>
        <form action={saveTrustCenterAction} className="app-form">
          <label style={{ display: "flex", alignItems: "center", gap: "10px", flexDirection: "row" }}>
            <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} style={{ width: "auto" }} />
            <span>Make the Trust Center publicly visible</span>
          </label>
          <label>Public web address (slug)<input name="slug" required minLength={3} maxLength={40} pattern="[a-z0-9-]+" defaultValue={settings?.slug ?? ""} placeholder="acme-security" /></label>
          <label>Headline (optional)<input name="headline" maxLength={280} defaultValue={settings?.headline ?? ""} placeholder="How we keep your data safe" /></label>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", flexDirection: "row" }}>
            <input type="checkbox" name="showPolicyTitles" defaultChecked={settings?.show_policy_titles ?? false} style={{ width: "auto" }} />
            <span>Also list the titles of approved policies (titles only — never their contents)</span>
          </label>
          <button className="button primary" style={{ justifySelf: "start" }}>Save Trust Center</button>
        </form>
        <p style={{ fontSize: "12px", color: "#596273", margin: "12px 0 0" }}>Your public page shows: organisation name, an ISO/IEC 27001-aligned ISMS statement, your framework readiness percentage, the count of controls in scope, the count of approved policies (and their titles if you opt in above), the date of your most recent completed internal audit, and a last-updated date.</p>
      </Card>

      {settings?.enabled && <Card style={{ padding: "18px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Switch off</h2>
        <p style={{ fontSize: "13px", color: "#4a5163", margin: "0 0 10px" }}>Taking the Trust Center offline hides the public page immediately. Your settings are kept so you can switch it back on later.</p>
        <form action={disableTrustCenterAction}>
          <button className="button" style={{ color: "var(--red)" }}>Switch off the Trust Center</button>
        </form>
      </Card>}
    </>}
  </>;
}
