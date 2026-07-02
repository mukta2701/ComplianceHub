"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

const nav = [
  ["/demo/dashboard", "home", "Dashboard"],
  ["/demo/assessment", "clipboard", "Gap assessment"],
  ["/demo/soa", "file", "Statement of Applicability"],
  ["/demo/risks", "alert", "Risk register"],
  ["/demo/settings", "settings", "Settings"],
] as const;

export function DemoShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const title = nav.find(([href]) => href === path)?.[2] ?? "ComplianceHub";
  return <div className="app-shell">
    <button className="nav-overlay" data-open={open} onClick={() => setOpen(false)} aria-label="Close navigation" />
    <aside className="sidebar" data-open={open}>
      <Link className="brand" href="/" onClick={() => setOpen(false)}><span className="brand-mark"><Icon name="shield" /></span><span>ComplianceHub</span></Link>
      <div className="workspace"><span className="avatar">NL</span><span><b>Northstar Labs</b><small>Demo workspace</small></span><Icon name="arrow" /></div>
      <nav aria-label="Main navigation">{nav.map(([href, icon, label]) => <Link key={href} href={href} className={path === href ? "active" : ""} onClick={() => setOpen(false)}><Icon name={icon} />{label}</Link>)}</nav>
      <div className="sidebar-foot"><div className="demo-pill">Demo mode</div><p>Your changes stay in this browser and may be reset.</p><Link href="/">Exit demo</Link></div>
    </aside>
    <div className="app-main">
      <header className="app-header"><button className="menu" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button><h1>{title}</h1><div className="header-actions"><span className="status-dot" />All changes saved<span className="user-avatar">PS</span></div></header>
      <div className="demo-banner"><Icon name="alert"/><span><b>You&apos;re viewing a demo.</b> Explore freely — this is sample data for Northstar Labs.</span><Link href="/">Create your workspace</Link></div>
      <main className="content">{children}</main>
      <footer className="legal">ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</footer>
    </div>
  </div>;
}
