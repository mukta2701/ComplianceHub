"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { AlertToaster } from "./alert-toaster";
import { signOutAction } from "@/app/app/actions";
import { roleLabel, type MembershipRole } from "@/features/organisations/domain/access";
import styles from "./app-shell.module.css";

const navGroups = [
  { label: "Work", items: [
    ["/app/tasks", "check", "Tasks"],
    ["/app/risks", "alert", "Risk register"],
    ["/app/evidence", "file", "Evidence"],
  ] },
  { label: "Programme", items: [
    ["/app/assessment", "clipboard", "Gap assessment"],
    ["/app/soa", "file", "Statement of Applicability"],
    ["/app/policies", "file", "Policies"],
    ["/app/assets", "file", "Asset inventory"],
  ] },
  { label: "Oversight", items: [
    ["/app/monitoring", "activity", "Monitoring"],
    ["/app/automation", "activity", "Automation inbox"],
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

const DRAWER_QUERY = "(max-width: 1024px)";
function subscribeToDrawer(callback: () => void) {
  const query = window.matchMedia(DRAWER_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const drawerSnapshot = () => window.matchMedia(DRAWER_QUERY).matches;

const memberNavGroups = [
  { label: null, items: [["/app", "home", "Overview"]] },
  { label: "Compliance", items: [
    ["/app/tasks?filter=assigned", "check", "Assigned tasks"],
    ["/app/policies", "file", "Policies"],
    ["/app/frameworks", "file", "Framework coverage"],
  ] },
  { label: null, items: [
    ["/app/monitoring", "activity", "Monitoring"],
    ["/app/reports/readiness", "file", "Leadership report"],
  ] },
] as const;

// Routes not in the sidebar still need a header title.
const EXTRA_TITLES: Array<[string, string]> = [
  ["/app", "Dashboard"],
  ["/app/assets/import", "Import asset inventory"],
  ["/app/assets", "Asset inventory"],
  ["/app/frameworks", "Framework coverage"],
  ["/app/activity", "Audit trail"],
  ["/app/notifications", "Notifications"],
  ["/app/integrations", "Connections"],
  ["/app/risks/import", "Import risk register"],
  ["/app/soa/import", "Import Statement of Applicability"],
  ["/app/audits/new", "Plan an audit"],
  ["/app/policies/new", "Author a policy"],
  ["/app/onboarding", "Workspace setup"],
  ["/app/invitations", "Invitation"],
  ["/app/automation", "Automation inbox"],
  ["/app/setup", "Automation setup"],
];
const TITLE_ROUTES: Array<[string, string]> = [
  ...navGroups.flatMap((g) => g.items.map(([href, , label]) => [href, label] as [string, string])),
  ...EXTRA_TITLES,
].sort((a, b) => b[0].length - a[0].length);

function isActive(path: string, href: string) {
  href = href.split("?")[0];
  if (href === "/app") return path === "/app";
  if (href === "/app/settings" && (path === "/app/integrations" || path.startsWith("/app/integrations/"))) return true;
  return path === href || path.startsWith(`${href}/`);
}

export function AppShell({ organisationId, orgName, orgInitials, userInitials, unreadCount, role, jobTitle, children }: { organisationId: string | null; orgName: string; orgInitials: string; userInitials: string; unreadCount: number; role: MembershipRole | null; jobTitle: string | null; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isDrawer = useSyncExternalStore(subscribeToDrawer, drawerSnapshot, () => false);
  const drawerOpen = open && isDrawer;
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNav = useRef<HTMLAnchorElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const closeNavigation = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  }, []);
  useEffect(() => {
    const query = window.matchMedia(DRAWER_QUERY);
    const resetOnDesktop = () => { if (!query.matches) setOpen(false); };
    query.addEventListener("change", resetOnDesktop);
    return () => query.removeEventListener("change", resetOnDesktop);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      (firstNav.current ?? navigation.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeNavigation(); }
      if (event.key !== "Tab") return;
      const items = navigation.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(focusFrame); document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); };
  }, [drawerOpen, closeNavigation]);
  const isMember = role === "member";
  const isOperator = role === "owner" || role === "admin";
  const title = isMember && path === "/app"
    ? "Overview"
    : TITLE_ROUTES.find(([href]) => isActive(path, href))?.[1] ?? "ComplianceHub";
  const accessCue = isMember ? "Member view" : role ? roleLabel(role) : "Workspace setup";
  const workspaceSubtitle = isMember
    ? `${jobTitle?.trim() || "Member"} · Assigned work access`
    : role ? roleLabel(role) : "Workspace setup";
  return <div className={`app-shell ${styles.shell}`}>
    <a className={styles.skipLink} href="#main-content">Skip to content</a>
    <button className="nav-overlay" data-open={drawerOpen} onClick={closeNavigation} aria-hidden="true" tabIndex={-1} />
    <aside ref={navigation} className="sidebar" id="app-navigation" data-open={drawerOpen} aria-label="Workspace navigation" role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen ? true : undefined} aria-hidden={isDrawer && !drawerOpen ? true : undefined} inert={isDrawer && !drawerOpen}>
      <button className={styles.closeNavigation} onClick={closeNavigation} aria-label="Close navigation">×</button>
      <Link className="brand" href="/app" onClick={() => setOpen(false)}><span className="brand-mark"><Icon name="shield" /></span><span>ComplianceHub</span></Link>
      <div className="workspace"><span className="avatar">{orgInitials}</span><span><b>{orgName}</b><small>{workspaceSubtitle}</small></span></div>
      {isMember && <nav aria-label="Workspace">
        {memberNavGroups.map((group, groupIndex) => (
          <div className="nav-group" key={group.label ?? `member-${groupIndex}`}>
            {group.label && <p className="nav-section-label">{group.label}</p>}
            {group.items.map(([href, icon, label]) => (
              <Link ref={href === "/app" ? firstNav : undefined} key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined} onClick={() => setOpen(false)}>
                <Icon name={icon} />{label}
              </Link>
            ))}
          </div>
        ))}
      </nav>}
      {isOperator && <nav aria-label="Workspace">
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
      </nav>}
      <div className="sidebar-foot"><form action={signOutAction} data-app-exit-form><button className="button secondary" style={{ width: "100%" }}>Sign out</button></form><p>ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</p></div>
    </aside>
    <div className="app-main" inert={drawerOpen}>
      <header className="app-header"><button ref={menuButton} className="menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="app-navigation"><Icon name="menu" /></button><h1>{title}</h1><div className="header-actions"><span className="pill neutral" aria-label="Portal access">{accessCue}</span><Link href="/app/notifications" className="notif-bell" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}><Icon name="bell" />{unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}</Link><span className="user-avatar">{userInitials}</span></div></header>
      <main className="content" id="main-content" tabIndex={-1}>{children}</main>
      <footer className="legal">ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</footer>
    </div>
    <div inert={drawerOpen} hidden={drawerOpen}><AlertToaster key={organisationId ?? "no-organisation"} organisationId={organisationId} /></div>
  </div>;
}
