import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, Ring, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

// The public payload is exactly what the security-definer RPC returns — a
// tightly whitelisted, positive summary. No sensitive detail (risks, findings,
// evidence, gaps, member identities, policy bodies) is ever present here; the
// whitelist is enforced server-side inside public.trust_center_view.
type Payload = {
  organisationName: string;
  headline: string | null;
  readinessPercent: number;
  controlsInScope: number;
  approvedPolicyCount: number;
  policyTitles: string[] | null;
  latestAuditDate: string | null;
  updatedAt: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default async function TrustCenterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient(); // anon role for a logged-out visitor
  // The ONLY data call on this public page: a single org-scoped RPC. No
  // service-role client and no direct table reads are used anywhere here.
  const { data } = await supabase.rpc("trust_center_view", { target_slug: slug });
  if (!data) {
    // Same neutral card for an unknown OR a disabled slug — no existence oracle.
    return <Card style={{ padding: "24px" }} role="alert"><h1 style={{ fontSize: "20px", margin: "0 0 8px" }}>This trust center is not available</h1><p>There is no published trust center at this address, or it has been switched off. Please check the link with your contact.</p></Card>;
  }
  const payload = data as Payload;
  return <>
    <h1 style={{ fontSize: "26px", margin: "0 0 4px" }}>{payload.organisationName} — Trust Center</h1>
    <p style={{ color: "#596273", margin: "0 0 20px" }}>Operating an ISO/IEC 27001-aligned information security management system</p>
    {payload.headline && <Card style={{ padding: "18px 22px", marginBottom: "16px" }}><p style={{ margin: 0, fontSize: "15px", color: "#2b3242" }}>{payload.headline}</p></Card>}
    <div className="stats-grid" style={{ alignItems: "center" }}>
      <Card style={{ display: "grid", placeItems: "center", padding: "20px" }}><Ring value={payload.readinessPercent} /></Card>
      <Stat label="CONTROLS IN SCOPE" value={payload.controlsInScope} detail="Annex A controls applied" tone="blue" />
      <Stat label="APPROVED POLICIES" value={payload.approvedPolicyCount} detail="published and approved" tone="green" />
      <Stat label="LAST INTERNAL AUDIT" value={formatDate(payload.latestAuditDate)} detail="most recent completed audit" tone="blue" />
    </div>
    {payload.policyTitles && payload.policyTitles.length > 0 && <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 12px" }}>Approved policies</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
        {payload.policyTitles.map((title) => <li key={title} style={{ fontSize: "14px", color: "#2b3242" }}>{title}</li>)}
      </ul>
    </Card>}
    <p style={{ marginTop: "20px", fontSize: "12px", color: "#596273" }}>Last updated {formatDate(payload.updatedAt)}.</p>
  </>;
}
