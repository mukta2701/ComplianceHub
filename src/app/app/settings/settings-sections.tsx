"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./settings-sections.module.css";

export type SettingsSectionKey = "workspace" | "team" | "security" | "ai-assistance" | "connected-apps";

const sectionLinks: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: "workspace", label: "Workspace" },
  { key: "team", label: "Team members" },
  { key: "security", label: "Security" },
  { key: "ai-assistance", label: "AI assistance" },
  { key: "connected-apps", label: "Connected assistants" },
];

function sectionFromHash(): SettingsSectionKey | undefined {
  const hash = window.location.hash.slice(1);
  if (hash === "invites") return "team";
  return sectionLinks.some((section) => section.key === hash) ? hash as SettingsSectionKey : undefined;
}

export function SettingsSections({
  initialSection,
  workspace,
  team,
  security,
  aiAssistance,
  connectedApps,
}: {
  initialSection?: SettingsSectionKey;
  workspace: ReactNode;
  team: ReactNode;
  security: ReactNode;
  aiAssistance: ReactNode;
  connectedApps: ReactNode;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(initialSection ?? "workspace");

  useEffect(() => {
    const syncToLocation = () => setActiveSection(sectionFromHash() ?? initialSection ?? "workspace");
    syncToLocation();
    window.addEventListener("hashchange", syncToLocation);
    window.addEventListener("popstate", syncToLocation);
    return () => {
      window.removeEventListener("hashchange", syncToLocation);
      window.removeEventListener("popstate", syncToLocation);
    };
  }, [initialSection]);

  const content: Record<SettingsSectionKey, ReactNode> = {
    workspace,
    team,
    security,
    "ai-assistance": aiAssistance,
    "connected-apps": connectedApps,
  };

  return (
    <div className={styles.layout}>
      <nav className={styles.navigation} aria-label="Settings sections">
        {sectionLinks.map((section) => (
          <a
            key={section.key}
            className={styles.navigationLink}
            href={`/app/settings#${section.key}`}
            aria-current={activeSection === section.key ? "location" : undefined}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              const url = new URL(window.location.href);
              url.hash = section.key;
              if (url.href !== window.location.href) window.history.pushState(null, "", url.href);
              setActiveSection(section.key);
            }}
          >
            {section.label}
          </a>
        ))}
      </nav>
      <div className={styles.content}>
        {sectionLinks.map((section) => (
          <div
            id={section.key === "ai-assistance" || section.key === "connected-apps" ? undefined : section.key}
            key={section.key}
            hidden={activeSection !== section.key}
          >
            {content[section.key]}
          </div>
        ))}
      </div>
    </div>
  );
}
