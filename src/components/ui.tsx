import Link from "next/link";
import { Icon } from "./icons";

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
  return <div className="page-intro"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2><p>{body}</p></div>{action}</div>;
}
export function Card({ children, className = "", ...props }: React.HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props}>{children}</section>; }
export function Stat({ label, value, detail, tone = "blue" }: { label: string; value: string | number; detail: string; tone?: string }) { return <Card className="stat"><span className={`stat-icon ${tone}`}><Icon name={tone === "green" ? "check" : tone === "amber" || tone === "red" ? "alert" : "file"}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></Card>; }
export function Progress({ value, tone = "blue" }: { value: number; tone?: string }) { return <div className="progress" role="progressbar" aria-label="Completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span className={tone} style={{ width: `${value}%` }}/></div>; }
export function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
export function Ring({ value, size = 132 }: { value: number; size?: number }) { return <div className="ring" style={{ "--value": `${value * 3.6}deg`, width: size, height: size } as React.CSSProperties}><span><strong>{value}%</strong><small>READY</small></span></div>; }
