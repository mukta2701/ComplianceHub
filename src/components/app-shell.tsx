"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { AlertToaster } from "./alert-toaster";
import { signOutAction } from "@/app/app/actions";

const navGroups = [
  { label: "Get ready", items: [
    ["/app/assessment", "clipboard", "Gap assessment"],
    ["/app/risks", "alert", "Risk register"],
    ["/app/soa", "file", "Statement of Applicability"],
    ["/app/evidence", "file", "Evidence"],
    ["/app/tasks", "check", "Tasks"],
  ] },
  { label: "Operate", items: [
    ["/app/monitoring", "activity", "Monitoring"],
    ["/app/policies", "file", "Policies"],
    ["/app/audits", "shield", "Internal audits"],
    ["/app/kpis", "check", "Performance"],
  ] },
  { label: "Share", items: [
    ["/app/reports/readiness", "file", "Leadership report"],
    ["/app/trust", "shield", "Trust Center"],
  ] },
  { label: "Admin", items: [
    ["/app/settings", "settings", "Settings"],
  ] },
] as const;

// Routes not in the sidebar still need a header title.
const EXTRA_TITLES: Array<[string, string]> = [
  ["/app", "Dashboard"],
  ["/app/assets/import", "Import asset inventory"],
  ["/app/assets", "Asset inventory"],
  ["/app/frameworks", "Framework coverage"],
  ["/app/activity", "Audit trail"],
  ["/app/integrations", "Connections"],
  ["/app/notifications", "Notifications"],
  ["/app/risks/import", "Import risk register"],
  ["/app/soa/import", "Import Statement of Applicability"],
  ["/app/audits/new", "Plan an audit"],
  ["/app/policies/new", "Author a policy"],
  ["/app/onboarding", "Workspace setup"],
  ["/app/invitations", "Invitation"],
];
const TITLE_ROUTES: Array<[string, string]> = [
  ...navGroups.flatMap((g) => g.items.map(([href, , label]) => [href, label] as [string, string])),
  ...EXTRA_TITLES,
].sort((a, b) => b[0].length - a[0].length);

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
  const title = TITLE_ROUTES.find(([href]) => isActive(path, href))?.[1] ?? "ComplianceHub";
  return <div className="app-shell">
    <button className="nav-overlay" data-open={open} onClick={() => setOpen(false)} aria-label="Close navigation" />
    <aside className="sidebar" id="app-navigation" data-open={open} aria-label="Workspace navigation">
      <Link className="brand" href="/app" onClick={() => setOpen(false)}><span className="brand-mark"><Icon name="shield" /></span><span>ComplianceHub</span></Link>
      <div className="workspace"><span className="avatar">{orgInitials}</span><span><b>{orgName}</b><small>Workspace</small></span><Icon name="arrow" /></div>
      <nav aria-label="Workspace">
        <div className="nav-group">
          <Link ref={firstNav} href="/app" className={isActive(path, "/app") ? "active" : ""} aria-current={isActive(path, "/app") ? "page" : undefined} onClick={() => setOpen(false)}>
            <Icon name="home" />Dashboard
          </Link>
        </div>
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-section-label">{group.label}</p>
            {group.items.map(([href, icon, label]) => (
              <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined} onClick={() => setOpen(false)}>
                <Icon name={icon} />{label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot"><form action={signOutAction} data-app-exit-form><button className="button secondary" style={{ width: "100%" }}>Sign out</button></form><p>ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</p></div>
    </aside>
    <div className="app-main">
      <header className="app-header"><button ref={menuButton} className="menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="app-navigation"><Icon name="menu" /></button><h1>{title}</h1><div className="header-actions"><Link href="/app/notifications" className="notif-bell" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}><Icon name="bell" />{unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}</Link><span className="user-avatar">{userInitials}</span></div></header>
      <main className="content">{children}</main>
      <footer className="legal">ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</footer>
    </div>
    <AlertToaster />
  </div>;
}
