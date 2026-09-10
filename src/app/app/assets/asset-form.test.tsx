import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("./edit-actions", () => ({ createAssetFormAction: actions.create, updateAssetFormAction: actions.update }));

import { AssetForm, type AssetFormValues } from "./asset-form";

const values: AssetFormValues = {
  reference: "AST-001", description: "Customer database", ownerLocation: "London",
  ownerId: "", categoryId: "", classification: "confidential", valueCriticality: "high",
  securityControls: "SSO and encrypted backups", lifespan: "7 years", lastUpdated: "2026-09-10", remarks: "Review quarterly",
};
const options = { categories: [{ id: "category-1", label: "Technology" }], owners: [] };

describe("AssetForm", () => {
  beforeEach(() => { actions.create.mockReset(); actions.update.mockReset(); });

  it("groups inventory decisions and provides a safe way back", () => {
    render(<AssetForm mode="create" values={values} options={options} cancelHref="/app/assets" />);
    expect(screen.getByRole("group", { name: "Asset identity" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Accountability and handling" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Safeguards and lifecycle" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/assets");
  });

  it("keeps the local draft paired with the original edit version", async () => {
    const user = userEvent.setup();
    const view = render(<AssetForm mode="edit" assetId="asset-1" expectedUpdatedAt="2026-09-10T01:00:00Z" values={values} options={options} cancelHref="/app/assets/asset-1" />);
    const description = screen.getByRole("textbox", { name: "Asset name" });
    await user.clear(description);
    await user.type(description, "Unsaved database name");
    view.rerender(<AssetForm mode="edit" assetId="asset-1" expectedUpdatedAt="2026-09-10T02:00:00Z" values={{ ...values, description: "New server name" }} options={options} cancelHref="/app/assets/asset-1" />);
    expect(description).toHaveValue("Unsaved database name");
    expect(view.container.querySelector('input[name="expectedUpdatedAt"]')).toHaveValue("2026-09-10T01:00:00Z");
  });

  it("shows field errors without clearing the draft", async () => {
    actions.create.mockResolvedValue({ error: "Check the highlighted fields and try again.", fieldErrors: { description: ["Enter an asset name"] } });
    const user = userEvent.setup();
    render(<AssetForm mode="create" values={values} options={options} cancelHref="/app/assets" />);
    await user.click(screen.getByRole("button", { name: "Create asset" }));
    expect(await screen.findByText("Enter an asset name")).toHaveAttribute("id", "asset-description-error");
    expect(screen.getByRole("textbox", { name: "Asset name" })).toHaveValue("Customer database");
    expect(screen.getByRole("textbox", { name: "Asset name" })).toHaveAttribute("aria-describedby", "asset-description-help asset-description-error");
  });
});
