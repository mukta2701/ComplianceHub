"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { signOutAction } from "@/app/app/actions";

const navGroups = [
  { label: "Assess", items: [
    ["/app", "home", "Dashboard"],
    ["/app/assessment", "clipboard", "Assessment"],
    ["/app/risks", "alert", "Risks"],
    ["/app/assets", "lock", "Assets"],
    ["/app/soa", "file", "SoA"],
  ] },
  { label: "Manage", items: [
    ["/app/policies", "file", "Policies"],
    ["/app/audits", "shield", "Audits"],
    ["/app/kpis", "check", "KPIs"],
    ["/app/tasks", "check", "Tasks"],
  ] },
  { label: "Evidence & reports", items: [
    ["/app/evidence", "file", "Evidence"],
    ["/app/reports/readiness", "file", "Reports"],
    ["/app/notifications", "bell", "Notifications"],
    ["/app/activity", "clipboard", "Activity"],
  ] },
  { label: "Admin", items: [
    ["/app/settings", "settings", "Settings"],
    ["/app/integrations", "lock", "Integrations"],
  ] },
] as const;

const TITLES: Array<[string, string]> = [
  ["/app/assessment", "Assessment"], ["/app/risks/import", "Import risk register"], ["/app/risks", "Risk register"],
  ["/app/soa/import", "Import Statement of Applicability"], ["/app/soa", "Statement of Applicability"],
  ["/app/tasks", "Tasks"], ["/app/evidence", "Evidence vault"], ["/app/notifications", "Notifications"],
  ["/app/activity", "Activity"], ["/app/settings", "Settings"], ["/app/onboarding", "Workspace setup"],
  ["/app/invitations", "Invitation"], ["/app/assets/import", "Import asset inventory"], ["/app/assets", "Asset inventory"],
  ["/app/audits/new", "Plan an audit"], ["/app/audits", "Internal audits"],
  ["/app/kpis", "Performance measures"], ["/app/reports/readiness", "Readiness report"],
  ["/app/policies/new", "Author a policy"], ["/app/policies", "Policy library"],
  ["/app/integrations", "Ticketing integrations"], ["/app", "Dashboard"],
];

function isActive(path: string, href: string) { return href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`); }

export function AppShell({ orgName, orgInitials, userInitials, unreadCount, children }: { orgName: string; orgInitials: string; userInitials: string; unreadCount: number; children: React.ReactNode }) {
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
  const title = TITLES.find(([href]) => isActive(path, href))?.[1] ?? "ComplianceHub";
  return <div className="app-shell">
    <button className="nav-overlay" data-open={open} onClick={() => setOpen(false)} aria-label="Close navigation" />
    <aside className="sidebar" id="app-navigation" data-open={open} aria-label="Workspace navigation">
      <Link className="brand" href="/app" onClick={() => setOpen(false)}><span className="brand-mark"><Icon name="shield" /></span><span>ComplianceHub</span></Link>
      <div className="workspace"><span className="avatar">{orgInitials}</span><span><b>{orgName}</b><small>Workspace</small></span><Icon name="arrow" /></div>
      <nav aria-label="Workspace">{navGroups.map((group) => <div className="nav-group" key={group.label}><p className="nav-section-label">{group.label}</p>{group.items.map(([href, icon, label]) => <Link ref={href === "/app" ? firstNav : undefined} key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined} onClick={() => setOpen(false)}><Icon name={icon} />{label}</Link>)}</div>)}</nav>
      <div className="sidebar-foot"><form action={signOutAction}><button className="button secondary" style={{ width: "100%" }}>Sign out</button></form><p>ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</p></div>
    </aside>
    <div className="app-main">
      <header className="app-header"><button ref={menuButton} className="menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="app-navigation"><Icon name="menu" /></button><h1>{title}</h1><div className="header-actions"><Link href="/app/notifications" className="notif-bell" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}><Icon name="bell" />{unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}</Link><span className="user-avatar">{userInitials}</span></div></header>
      <main className="content">{children}</main>
      <footer className="legal">ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</footer>
    </div>
  </div>;
}
