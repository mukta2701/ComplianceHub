"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SubTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav className="segmented" aria-label="Section" style={{ marginBottom: "16px" }}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined} className={active(t.href) ? "active" : ""}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
