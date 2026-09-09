import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ result: {} as { error?: string } }));
vi.mock("./actions", () => ({ saveBaselineAction: async () => state.result }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));
import { BaselineForm } from "./baseline-form";
beforeEach(() => { state.result = {}; });
describe("baseline form", () => {
  it("resumes objective and selected assessment with both save choices", () => {
    render(<BaselineForm objective="Original goal" assessmentId="assessment" revision={2} requestId="request" assessments={[{id:"assessment",title:"Readiness"}]} />);
    expect(screen.getByRole("textbox", {name:"Objective"})).toHaveValue("Original goal");
    expect(screen.getByRole("combobox", {name:"Assessment"})).toHaveValue("assessment");
    expect(screen.getByRole("button",{name:"Save progress"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Save dated baseline"})).toBeInTheDocument();
  });
  it("retains the entered objective after a rejected stale save", async () => {
    state.result = {error:"Reload before saving. Another coordinator changed this baseline."};
    render(<BaselineForm objective="" assessmentId={null} revision={0} requestId="request" assessments={[]} />);
    const user=userEvent.setup(); await user.type(screen.getByRole("textbox",{name:"Objective"}),"Careful objective");
    await user.click(screen.getByRole("button",{name:"Save progress"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reload");
    expect(screen.getByRole("textbox",{name:"Objective"})).toHaveValue("Careful objective");
  });
});
