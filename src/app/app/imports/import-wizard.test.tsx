import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "./import-wizard";

const actions = vi.hoisted(() => ({ analyse: vi.fn(), run: vi.fn() }));
vi.mock("./actions", () => ({ analyseImportAction: actions.analyse, runImportAction: actions.run }));
const preview = { committed: false, total: 1, valid: 1, invalid: 0, imported: 1, updated: 1, skipped: 0, rowErrors: [], notes: [] };
const fields = [{ key: "description", label: "Description", required: true }, { key: "ownerLocation", label: "Owner & Location", required: false }];

beforeEach(() => {
  actions.analyse.mockReset().mockResolvedValue({ headers: ["Description"], rows: [["Fictional service"]], suggestion: { Description: "description" } });
  actions.run.mockReset().mockResolvedValue(preview);
});

async function upload(module: "asset" | "soa" = "asset") {
  const user = userEvent.setup();
  render(<ImportWizard module={module} fields={fields} recordsHref="/app/assets" recordsLabel="assets" registers={module === "soa" ? [{ id: "one", title: "First register" }, { id: "two", title: "Second register" }] : undefined} />);
  await user.upload(screen.getByLabelText("Workbook file (XLSX or CSV)"), new File(["Description\nFictional service"], "fictional.csv", { type: "text/csv" }));
  fireEvent.submit(screen.getByRole("button", { name: "Analyse file" }).closest("form")!);
  await screen.findByRole("heading", { name: "2. Map columns" });
  return user;
}

describe("Import preview confirmation", () => {
  it("requires a new preview after a column mapping changes", async () => {
    const user = await upload();
    await user.click(screen.getByRole("button", { name: "Preview 1 row" }));
    await screen.findByRole("button", { name: "4. Confirm import (1)" });

    await user.selectOptions(screen.getByLabelText("Map column Description"), "ownerLocation");

    await waitFor(() => expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument());
    expect(actions.run).toHaveBeenCalledTimes(1);
  });

  it("requires a new preview after the target register changes", async () => {
    const user = await upload("soa");
    await user.click(screen.getByRole("button", { name: "Preview 1 control update" }));
    await screen.findByRole("button", { name: "4. Confirm import (1)" });

    await user.selectOptions(screen.getByLabelText("Target SoA register"), "two");

    await waitFor(() => expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument());
    expect(actions.run).toHaveBeenCalledTimes(1);
  });

  it("locks the workbook and target register while analysis is pending", async () => {
    let completeAnalysis: (value: { headers: string[]; rows: string[][]; suggestion: Record<string, string> }) => void;
    actions.analyse.mockImplementationOnce(() => new Promise((resolve) => { completeAnalysis = resolve; }));
    const user = userEvent.setup();
    render(<ImportWizard module="soa" fields={fields} recordsHref="/app/assets" recordsLabel="assets" registers={[{ id: "one", title: "First register" }]} />);
    await user.upload(screen.getByLabelText("Workbook file (XLSX or CSV)"), new File(["Description\nFictional service"], "fictional.csv", { type: "text/csv" }));
    fireEvent.submit(screen.getByRole("button", { name: "Analyse file" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByLabelText("Workbook file (XLSX or CSV)")).toBeDisabled();
      expect(screen.getByLabelText("Target SoA register")).toBeDisabled();
    });

    await act(async () => completeAnalysis!({ headers: ["Description"], rows: [["Fictional service"]], suggestion: { Description: "description" } }));
    await screen.findByRole("heading", { name: "2. Map columns" });
  });

  it("consumes confirmation while committing and restores it after a fresh preview", async () => {
    const user = await upload();
    await user.click(screen.getByRole("button", { name: "Preview 1 row" }));
    const confirm = await screen.findByRole("button", { name: "4. Confirm import (1)" });
    let completeCommit: (value: typeof preview) => void;
    actions.run.mockImplementationOnce(() => new Promise((resolve) => { completeCommit = resolve; }));

    await user.click(confirm);

    await waitFor(() => expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument());
    await act(async () => completeCommit!(preview));
    await screen.findByRole("heading", { name: "Import complete" });
    expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Map column Description"), "ownerLocation");
    await user.click(screen.getByRole("button", { name: "Preview 1 row" }));

    expect(await screen.findByRole("button", { name: "4. Confirm import (1)" })).toBeInTheDocument();
  });

  it("requires analysis again after the workbook changes", async () => {
    const user = await upload();
    await user.click(screen.getByRole("button", { name: "Preview 1 row" }));
    await user.click(await screen.findByRole("button", { name: "4. Confirm import (1)" }));
    await screen.findByRole("heading", { name: "Import complete" });

    await user.upload(screen.getByLabelText("Workbook file (XLSX or CSV)"), new File(["Description\nReplacement service"], "replacement.csv", { type: "text/csv" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "2. Map columns" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Import complete" })).not.toBeInTheDocument();
    });
  });

  it("locks import settings while previewing and confirming", async () => {
    const user = await upload("soa");
    let completePreview: (value: typeof preview) => void;
    actions.run.mockImplementationOnce(() => new Promise((resolve) => { completePreview = resolve; }));

    await user.click(screen.getByRole("button", { name: "Preview 1 control update" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Workbook file (XLSX or CSV)")).toBeDisabled();
      expect(screen.getByLabelText("Target SoA register")).toBeDisabled();
      expect(screen.getByLabelText("Map column Description")).toBeDisabled();
    });
    await act(async () => completePreview!(preview));
    const confirm = await screen.findByRole("button", { name: "4. Confirm import (1)" });
    let completeCommit: (value: typeof preview) => void;
    actions.run.mockImplementationOnce(() => new Promise((resolve) => { completeCommit = resolve; }));

    await user.click(confirm);

    await waitFor(() => {
      expect(screen.getByLabelText("Workbook file (XLSX or CSV)")).toBeDisabled();
      expect(screen.getByLabelText("Target SoA register")).toBeDisabled();
      expect(screen.getByLabelText("Map column Description")).toBeDisabled();
    });
    await act(async () => completeCommit!(preview));
    await screen.findByRole("heading", { name: "Import complete" });
  });
});
