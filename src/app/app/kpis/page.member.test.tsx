import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function query(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" },
    membership: { role: "member" },
    supabase: { from: (table: string) => query(table === "kpis" ? [{ id: "kpi-1", control_function: "Access", indicator: "Review completion", measurement_type: "manual", threshold: "100%", observations: null, next_steps: "Review exceptions", last_reviewed: "2026-09-01", task_id: null }] : table === "kpi_measurements" ? [{ kpi_id: "kpi-1", value: 90, measured_on: "2026-09-01" }] : []) },
  }),
}));

vi.mock("./actions", () => ({ createKpiAction: vi.fn(), raiseKpiTaskAction: vi.fn(), recordKpiMeasurementAction: vi.fn() }));

import KpisPage from "./page";

describe("KpisPage member branch", () => {
  it("shows KPI results without definition, measurement, or task controls", async () => {
    render(await KpisPage());

    expect(screen.getByRole("heading", { name: "Performance measures" })).toBeInTheDocument();
    expect(screen.getByText("Review completion")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add a KPI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise task" })).not.toBeInTheDocument();
  });
});
