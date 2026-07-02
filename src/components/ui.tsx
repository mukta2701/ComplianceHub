import { Icon } from "./icons";

export function PageIntro({ eyebrow, title, body, action }: { eyebrow?: string; title: string; body: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2><p>{body}</p></div>{action}</div>;
}
export function Card({ children, className = "", ...props }: React.HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props}>{children}</section>; }
export function Stat({ label, value, detail, tone = "blue" }: { label: string; value: string | number; detail: string; tone?: string }) { return <Card className="stat"><span className={`stat-icon ${tone}`}><Icon name={tone === "green" ? "check" : tone === "amber" || tone === "red" ? "alert" : "file"}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></Card>; }
export function Progress({ value, tone = "blue" }: { value: number; tone?: string }) { return <div className="progress" role="progressbar" aria-label="Completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span className={tone} style={{ width: `${value}%` }}/></div>; }
export function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
export function Ring({ value, size = 132 }: { value: number; size?: number }) { return <div className="ring" style={{ "--value": `${value * 3.6}deg`, width: size, height: size } as React.CSSProperties}><span><strong>{value}%</strong><small>READY</small></span></div>; }
