import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Operation = { name: string; args: unknown[] };
type QueryRecord = { table: string; operations: Operation[]; selectedWithHead: boolean };

const fixture = vi.hoisted(() => ({
  failTaskRows: false,
  nullCounts: false,
  role: "owner",
  queries: [] as QueryRecord[],
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tasks" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function query(table: string) {
  const record: QueryRecord = { table, operations: [], selectedWithHead: false };
  fixture.queries.push(record);
  const chain: Record<string, unknown> = {};
  for (const name of ["eq", "in", "not", "lt", "neq", "order", "limit"]) {
    chain[name] = (...args: unknown[]) => {
      record.operations.push({ name, args });
      return chain;
    };
  }
  chain.select = (...args: unknown[]) => {
    record.selectedWithHead = Boolean((args[1] as { head?: boolean } | undefined)?.head);
    record.operations.push({ name: "select", args });
    return chain;
  };
  chain.then = (resolve: (value: unknown) => unknown) => {
    const taskRows = [{
      id: "task-1", title: "Rotate service credentials", detail: "Record the completed rotation.",
      status: "in_progress", due_on: "2026-09-01", recurrence: null, source: "manual", owner_id: "person-1",
      profiles: { display_name: "Alex" },
    }];
    const failed = table === "tasks" && !record.selectedWithHead && fixture.failTaskRows;
    const value = record.selectedWithHead
      ? { data: null, error: null, count: fixture.nullCounts ? null : table === "tasks" ? 1 : 0 }
      : { data: table === "tasks" ? taskRows : [], error: failed ? { message: "read failed" } : null, count: null };
    return Promise.resolve(value).then(resolve);
  };
  return chain;
}

vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  supabase: { from: query }, organisation: { id: "org" }, membership: { role: fixture.role }, user: { id: "operator" },
}) }));

import TasksPage from "./page";

describe("tasks work queue", () => {
  beforeEach(() => { fixture.failTaskRows = false; fixture.nullCounts = false; fixture.role = "owner"; fixture.queries = []; });

  it("applies the overdue definition in the database before limiting rows", async () => {
    render(await TasksPage({ searchParams: Promise.resolve({ filter: "overdue" }) }));
    expect(screen.getByRole("heading", { name: "Work queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Deadline health" })).toBeInTheDocument();
    const listQuery = fixture.queries.find((entry) => entry.table === "tasks" && !entry.selectedWithHead && entry.operations.some((op) => op.name === "limit"));
    expect(listQuery?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "in", args: ["status", ["open", "in_progress"]] }),
      expect.objectContaining({ name: "not", args: ["due_on", "is", null] }),
      expect.objectContaining({ name: "lt", args: ["due_on", expect.any(String)] }),
    ]));
    expect(listQuery!.operations.findIndex((op) => op.name === "lt")).toBeLessThan(listQuery!.operations.findIndex((op) => op.name === "limit"));
  });

  it("fails closed when the task register cannot be read", async () => {
    fixture.failTaskRows = true;
    await expect(TasksPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load tasks");
  });
  it("fails closed when exact summary counts are unavailable", async () => {
    fixture.nullCounts = true;
    await expect(TasksPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load task counts");
  });
  it("does not show a reviewer-only count to members", async () => {
    fixture.role = "member";
    render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("Awaiting your review")).not.toBeInTheDocument();
    expect(screen.getByText("Recurring")).toBeInTheDocument();
  });
  it("describes the review count as permission-scoped", async () => {
    render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Awaiting your review")).toBeInTheDocument();
    expect(screen.getByText("No submissions you can review")).toBeInTheDocument();
  });
  it("drills the combined open-work count into the same status population", async () => {
    render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(within(screen.getByRole("region", { name: "Work summary" })).getByRole("link", { name: /Open work/i })).toHaveAttribute("href", "/app/tasks?filter=active");
  });

  it("exposes essential task facts in responsive rows", async () => {
    const { container } = render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(container.querySelector('td[data-label="Owner"]')).toHaveTextContent("Alex");
    expect(container.querySelector('td[data-label="Due"]')).toHaveTextContent("2026-09-01");
    expect(container.querySelector('td[data-label="Status"]')).toBeInTheDocument();
  });
});
