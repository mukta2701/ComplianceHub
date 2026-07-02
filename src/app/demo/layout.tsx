import { DemoShell } from "@/components/demo-shell";
import "./demo.css";
export default function DemoLayout({ children }: { children: React.ReactNode }) { return <DemoShell>{children}</DemoShell>; }
