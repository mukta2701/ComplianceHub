import type { ReactNode } from "react";
import { Icon } from "./icons";

export type StatusTone = "neutral" | "confirmed" | "attention" | "risk" | "ai";

export function StatusLabel({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: StatusTone;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <span className="status-label" data-tone={tone}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}
