import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BaselineReport } from "./baseline-report";
import type { BaselinePayload } from "@/features/baselines/domain/summary";
const payload: BaselinePayload = { schemaVersion:1,calculationVersion:1,organisationId:"org",organisationName:"Example",objective:"Readiness for leadership",savedAt:"2026-09-09T12:00:00Z",progressRevision:1,scope:null,assessment:null,questions:[],tasks:[{id:"t",title:"Restore backup",status:"open",owner_id:null,owner_name:null,due_on:null,updated_at:"2026-09-09",assignment_revision:0}],contributions:[],evidence:[],risks:[],riskConfig:null };
describe("saved baseline report", () => {
  it("explains missing inputs, decisions and source-linked work to Members", () => {
    render(<BaselineReport payload={payload} previous={null} operator={false} />);
    expect(screen.getByRole("heading", {name:"Dated baseline"})).toBeInTheDocument();
    expect(screen.getByText("Readiness for leadership")).toBeInTheDocument();
    expect(screen.getByText("Partial baseline")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:/Assign an owner/})).toHaveAttribute("href","#task-t");
    expect(screen.getByRole("link",{name:"Open task"})).toHaveAttribute("href","/app/tasks/t");
    expect(screen.getByText(/does not evaluate live provider/)).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:"Edit scope"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("does not present changed scope as an improvement", () => {
    render(<BaselineReport payload={payload} previous={{...payload,objective:"Different goal"}} operator />);
    expect(screen.getByText(/objective changed/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Edit scope"})).toHaveAttribute("href","/app/scope");
  });
});
