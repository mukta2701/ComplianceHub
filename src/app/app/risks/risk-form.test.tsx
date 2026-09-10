import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("./edit-actions", () => ({ createRiskFormAction: actions.create, updateRiskFormAction: actions.update }));

import { RiskForm, type RiskFormValues } from "./risk-form";

const values: RiskFormValues = {
  reference: "R-001", title: "Supplier access", description: "A supplier can reach production.",
  categoryId: "category-1", ownerId: "", reviewDate: "", likelihood: "4", impact: "4",
  residualLikelihood: "2", residualImpact: "3", treatment: "mitigate", status: "open",
  treatmentPlan: "Restrict access", evidence: "", sourceAssessmentSessionId: "",
};
const options = { categories: [{ id: "category-1", label: "Suppliers" }], owners: [] };

describe("RiskForm", () => {
  beforeEach(() => { actions.create.mockReset(); actions.update.mockReset(); });

  it("groups the decisions and offers a safe way back", () => {
    render(<RiskForm mode="create" values={values} options={options} cancelHref="/app/risks" />);
    expect(screen.getByRole("group", { name: "Risk context" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Exposure scoring" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Treatment and review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/risks");
  });

  it("keeps a local draft and the original edit version together", async () => {
    const user = userEvent.setup();
    const view = render(<RiskForm mode="edit" riskId="risk-1" expectedUpdatedAt="2026-09-10T01:00:00Z" values={values} options={options} cancelHref="/app/risks/risk-1" />);
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Local unsaved risk");
    view.rerender(<RiskForm mode="edit" riskId="risk-1" expectedUpdatedAt="2026-09-10T02:00:00Z" values={{ ...values, title: "New server title" }} options={options} cancelHref="/app/risks/risk-1" />);
    expect(title).toHaveValue("Local unsaved risk");
    expect(view.container.querySelector('input[name="expectedUpdatedAt"]')).toHaveValue("2026-09-10T01:00:00Z");
  });

  it("associates returned field errors without clearing entered values", async () => {
    actions.create.mockResolvedValue({ error: "Check the highlighted fields and try again.", fieldErrors: { title: ["Enter a risk title"] } });
    const user = userEvent.setup();
    render(<RiskForm mode="create" values={{ ...values, title: "Draft title" }} options={options} cancelHref="/app/risks" />);
    await user.click(screen.getByRole("button", { name: "Create risk" }));
    expect(await screen.findByText("Enter a risk title")).toHaveAttribute("id", "risk-title-error");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Draft title");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveAttribute("aria-describedby", "risk-title-error");
  });
});
