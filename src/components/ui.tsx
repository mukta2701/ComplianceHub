import Link from "next/link";
import { Icon } from "./icons";
import { PageHeading } from "./page-heading";
import type { ModuleGuidance } from "@/features/education/domain/guidance";

export function EmptyState({ icon, title, body, primary, secondary, action }: { icon: string; title: string; body: string; primary?: { href: string; label: string }; secondary?: { href: string; label: string }; action?: React.ReactNode }) {
  return <Card style={{ padding: "48px 24px", textAlign: "center" }}>
    <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--blue-pale)", color: "var(--blue)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Icon name={icon} /></div>
    <h2 style={{ fontSize: "16px", margin: "0 0 6px" }}>{title}</h2>
    <p style={{ fontSize: "13px", color: "#596273", margin: "0 auto 18px", maxWidth: "440px" }}>{body}</p>
    <span style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
      {action ?? <>
        {primary && <Link className="button primary" href={primary.href}><Icon name="plus" />{primary.label}</Link>}
        {secondary && <Link className="button secondary" href={secondary.href}>{secondary.label}</Link>}
      </>}
    </span>
  </Card>;
}
export function PageIntro({ eyebrow, title, body, action }: { eyebrow?: string; title: string; body: string; action?: React.ReactNode }) {
  return <PageHeading eyebrow={eyebrow} title={title} body={body} action={action} headingLevel={2} />;
}
export function ModuleExplainer({ guidance }: { guidance: ModuleGuidance }) {
  return <Card aria-label="How this part of ComplianceHub works" style={{ padding: "18px", marginBottom: "18px", borderColor: "#cfe0fb", background: "#fbfdff" }}>
    <div style={{ display: "grid", gap: "10px" }}>
      <div><b style={{ fontSize: "13px" }}>Why this matters</b><p style={{ margin: "4px 0 0", color: "#596273", fontSize: "13px", lineHeight: 1.5 }}>{guidance.why}</p></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px" }}>
        <div><b style={{ fontSize: "12px" }}>What you decide</b><p style={{ margin: "4px 0 0", color: "#596273", fontSize: "12px", lineHeight: 1.45 }}>{guidance.decision}</p></div>
        <div><b style={{ fontSize: "12px" }}>What happens next</b><p style={{ margin: "4px 0 0", color: "#596273", fontSize: "12px", lineHeight: 1.45 }}>{guidance.nextStep}</p></div>
      </div>
      <details><summary style={{ cursor: "pointer", color: "var(--blue)", fontSize: "12px", fontWeight: 700 }}>Key terms</summary><ul style={{ margin: "10px 0 0", paddingLeft: "18px", color: "#596273", fontSize: "12px", lineHeight: 1.5 }}>{guidance.terms.map((term) => <li key={term.term}><b>{term.term}:</b> {term.definition}</li>)}</ul></details>
    </div>
  </Card>;
}
export function Card({ children, className = "", ...props }: React.HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props}>{children}</section>; }
export function Stat({ label, value, detail, tone = "blue" }: { label: string; value: string | number; detail: string; tone?: string }) { return <Card className="stat"><span className={`stat-icon ${tone}`}><Icon name={tone === "green" ? "check" : tone === "amber" || tone === "red" ? "alert" : "file"}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></Card>; }
export function Progress({ value, tone = "blue", label = "Completion" }: { value: number; tone?: string; label?: string }) { return <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span className={tone} style={{ width: `${value}%` }}/></div>; }
export function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
export function Ring({ value, size = 132 }: { value: number; size?: number }) {
  const r = 80, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, value));
  return <div className="ring" style={{ width: size, height: size }}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle className="ring-track" cx="100" cy="100" r={r} />
      <circle className="ring-arc" cx="100" cy="100" r={r} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - pct / 100) }} />
    </svg>
    <span><strong>{value}%</strong><small>READY</small></span>
  </div>;
}
