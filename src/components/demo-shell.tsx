"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

const nav = [
  ["/demo/dashboard", "home", "Dashboard"],
  ["/demo/assessment", "clipboard", "Gap assessment"],
  ["/demo/soa", "file", "Statement of Applicability"],
  ["/demo/risks", "alert", "Risk register"],
  ["/demo/tasks", "check", "Tasks"],
  ["/demo/evidence", "file", "Evidence vault"],
  ["/demo/settings", "settings", "Settings"],
] as const;

export function DemoShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNav = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!open) return;
    firstNav.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const title = nav.find(([href]) => href === path)?.[2] ?? "ComplianceHub";
  return <div className="app-shell">
    <button className="nav-overlay" data-open={open} onClick={() => setOpen(false)} aria-label="Close navigation" />
    <aside className="sidebar" id="demo-navigation" data-open={open} aria-label="Workspace navigation">
      <Link className="brand" href="/" onClick={() => setOpen(false)}><span className="brand-mark"><Icon name="shield" /></span><span>ComplianceHub</span></Link>
      <div className="workspace"><span className="avatar">NL</span><span><b>Northstar Labs</b><small>Demo workspace</small></span><Icon name="arrow" /></div>
      <nav aria-label="Main navigation">{nav.map(([href, icon, label], index) => <Link ref={index === 0 ? firstNav : undefined} key={href} href={href} className={path === href ? "active" : ""} aria-current={path === href ? "page" : undefined} onClick={() => setOpen(false)}><Icon name={icon} />{label}</Link>)}</nav>
      <div className="sidebar-foot"><div className="demo-pill">Demo mode</div><p>Your changes stay in this browser and may be reset.</p><Link href="/">Exit demo</Link></div>
    </aside>
    <div className="app-main">
      <header className="app-header"><button ref={menuButton} className="menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="demo-navigation"><Icon name="menu" /></button><h1>{title}</h1><div className="header-actions"><span className="status-dot" />All changes saved<span className="user-avatar">PS</span></div></header>
      <div className="demo-banner"><Icon name="alert"/><span><b>You&apos;re viewing a demo.</b> Explore freely — this is sample data for Northstar Labs.</span><Link href="/">Create your workspace</Link></div>
      <main className="content">{children}</main>
      <footer className="legal">ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</footer>
    </div>
  </div>;
}
