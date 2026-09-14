import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member", empty: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/tasks",
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/app/imports/import-wizard", () => ({ ImportWizard: () => <div>Import wizard</div> }));
const risk = { id: "risk", reference: "R-001", title: "Supplier risk", description: "Supplier exposure", likelihood: 3, impact: 3, residual_likelihood: 2, residual_impact: 2, status: "open", treatment: "mitigate", review_date: null };
const asset = { id: "asset", reference: "A-001", description: "Customer database", classification: "confidential", value_criticality: "high", owner_id: null };
const task = { id: "task", title: "Review supplier", status: "open", source: "manual", recurrence: null, due_on: null, owner_id: null };
function query(table: string) {
  let single = false;
  const rows: Record<string, unknown[]> = {
    risks: [risk], assets: [asset], tasks: [task],
    risk_treatment_plans: [{ id: "rtp", reference: "RTP-001", status: "planned" }],
    asset_risks: [{ risk_id: "risk", risks: risk }],
    assessment_responses: [{ session_id: "session", question_id: "question", catalogue_questions: { code: "GOV-01", prompt: "Review access" } }],
    catalogue_questions: [{ id: "question", prompt: "Review access" }],
    integration_connections: [{ id: "connection", label: "Tracker", provider: "github" }],
  };
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit", "in", "not", "lt", "neq", "is", "gt", "range"]) chain[name] = () => chain;
  for (const name of ["single", "maybeSingle"]) chain[name] = () => { single = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => {
    const data = state.empty ? [] : (rows[table] ?? []);
    return Promise.resolve({ data: single ? data[0] ?? null : data, error: null, count: data.length }).then(resolve);
  };
  return chain;
}
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  supabase: { from: query }, membership: { role: state.role }, organisation: { id: "org" }, user: { id: "user" },
}) }));

import RisksPage from "../risks/page";
import RiskDetailPage from "../risks/[id]/page";
import AssetsPage from "../assets/page";
import AssetDetailPage from "../assets/[id]/page";
import TasksPage from "./page";
import TaskDetailPage from "./[id]/page";
import NewRiskPage from "../risks/new/page";
import RiskImportPage from "../risks/import/page";
import NewAssetPage from "../assets/new/page";
import AssetImportPage from "../assets/import/page";
import EditAssetPage from "../assets/[id]/edit/page";
import NewTaskPage from "./new/page";
import FromGapPage from "./from-gap/page";

const readablePages = [
  ["risks", () => RisksPage(), "Supplier risk"],
  ["risk detail", () => RiskDetailPage({ params: Promise.resolve({ id: "risk" }) }), "Supplier risk"],
  ["assets", () => AssetsPage(), "Customer database"],
  ["asset detail", () => AssetDetailPage({ params: Promise.resolve({ id: "asset" }) }), "Customer database"],
  ["tasks", () => TasksPage({ searchParams: Promise.resolve({}) }), "Review supplier"],
  ["task detail", () => TaskDetailPage({ params: Promise.resolve({ id: "task" }) }), "Review supplier"],
] as const;
const writePages = [
  ["new risk", () => NewRiskPage({ searchParams: Promise.resolve({}) }), "/app/risks"],
  ["risk import", () => RiskImportPage(), "/app/risks"],
  ["new asset", () => NewAssetPage(), "/app/assets"],
  ["asset import", () => AssetImportPage(), "/app/assets"],
  ["asset edit", () => EditAssetPage({ params: Promise.resolve({ id: "asset" }) }), "/app/assets/asset"],
  ["new task", () => NewTaskPage(), "/app/tasks"],
  ["gap task", () => FromGapPage({ searchParams: Promise.resolve({ questionId: "question" }) }), "/app/tasks"],
] as const;

beforeEach(() => { state.role = "member"; state.empty = false; });
describe("read-only Member registers", () => {
  it.each(readablePages)("keeps %s readable without mutation controls", async (_name, page, text) => {
    const { container } = render(await page());
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href$="/new"],a[href$="/import"],a[href$="/edit"],a[href*="/from-gap"]')).toBeNull();
  });
  it.each(["risks", "assets", "tasks"])("does not offer mutations in an empty %s register", async (name) => {
    state.empty = true;
    const page = readablePages.find(([id]) => id === name)![1];
    const { container } = render(await page());
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href$="/new"],a[href$="/import"]')).toBeNull();
  });
  it.each(writePages)("redirects a Member entering %s", async (_name, page, destination) => {
    await expect(page()).rejects.toThrow(`REDIRECT:${destination}`);
  });
});
describe.each(["owner", "admin"])("%s register operations", (role) => {
  it.each(readablePages)("preserves controls on %s", async (_name, page) => {
    state.role = role;
    const { container } = render(await page());
    expect(container.querySelector('form,a[href$="/new"]')).not.toBeNull();
  });
  it.each(writePages)("allows entry to %s", async (_name, page) => {
    state.role = role;
    await expect(page()).resolves.toBeTruthy();
  });
});
