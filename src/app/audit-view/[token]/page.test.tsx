import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient:() => Promise.resolve({ rpc }) }));

import AuditViewPage from "./page";

it("shows checklist-linked proof with freshness kept separate from the human result", async () => {
  rpc.mockResolvedValue({ data:{
    organisationName:"Fictional Systems Ltd",
    accessScope:"audit",
    framework:"SOC 2 Type II",
    generatedAt:"2026-09-11T00:00:00.000Z",
    soa:[],
    risks:[],
    tasks:{ open:0,overdue:0 },
    evidence:[{ status:"expired" }],
    audits:[{ status:"in_progress" }],
    openNonConformities:0,
    audit:{
      reference:"AUD-001",
      title:"Access review",
      status:"in_progress",
      scope:"Privileged access",
      checklist:[{
        area:"Access",
        clauseReference:"A.5",
        checklistItem:"Review privileged access",
        compliant:"compliant",
        evidenceNote:"Reviewed by the audit lead",
        linkedEvidence:[{
          id:"evidence-1",
          title:"Privileged access export",
          kind:"note",
          status:"expired",
          collectedOn:"2026-08-01",
          validUntil:"2026-09-01",
          sourceProvider:"google_workspace",
          sourceLabel:"Production directory",
          linkedOn:"2026-09-02T00:00:00.000Z",
        }],
      }],
      findings:[],
    },
  },error:null });

  render(await AuditViewPage({ params:Promise.resolve({ token:crypto.randomUUID() }) }));

  expect(screen.getByRole("heading", { name:"AUD-001: Access review" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name:"Fictional Systems Ltd — audit review" })).toBeInTheDocument();
  expect(screen.getByText(/SOC 2 Type II/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name:"Readiness summary" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name:"Risk posture" })).not.toBeInTheDocument();
  expect(screen.getByText("Reviewed by the audit lead")).toBeInTheDocument();
  expect(screen.getByText("Privileged access export")).toBeInTheDocument();
  expect(screen.getByText("note evidence · Production directory (Google Workspace)")).toBeInTheDocument();
  expect(screen.getByText("expired")).toBeInTheDocument();
  expect(screen.getByText("Freshness describes this record. The audit result is a separate human decision.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name:"Privileged access export" })).not.toBeInTheDocument();
});
