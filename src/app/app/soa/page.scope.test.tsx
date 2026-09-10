import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  queries: [] as Array<{ table: string; column: string; value: unknown }>,
  selections: [] as Array<{ table: string; value: string }>,
  limits: [] as Array<{ table: string; value: number }>,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("../actions", () => ({ createSoaAction: vi.fn(), createSoaSuccessorAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/soa" }));

function activeContext(overrides: Record<string, Array<Record<string, unknown>>> = {}, role = "owner", failedTable?: string, cappedTable?: string) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    assessment_sessions: [{ id: "assessment-sibling", organisation_id: OTHER_ORGANISATION_ID, title: "Sibling assessment", updated_at: "2026-08-18T00:00:00Z" }],
    soa_registers: [{ id: "register-sibling", organisation_id: OTHER_ORGANISATION_ID, title: "Sibling draft", version: 2, updated_at: "2026-08-18T00:00:00Z" }],
    soa_snapshots: [{ id: "snapshot-sibling", organisation_id: OTHER_ORGANISATION_ID, title: "Sibling snapshot", version: 1, finalised_at: "2026-08-18T00:00:00Z" }],
  };
  Object.assign(rows, overrides);
  const supabase = {
    from(table: string) {
      const orders: Array<{ column: string; ascending: boolean }> = [];
      const equals: Array<[string, unknown]> = [];
      const inclusions: Array<[string, unknown[]]> = [];
      // The minimal fake deliberately leaves Supabase's fluent builder dynamic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: Record<string, (...args: any[]) => any> = {
        select: vi.fn((value: string) => { hoisted.selections.push({ table, value }); return builder; }),
        eq: vi.fn((column: string, value: unknown) => {
          equals.push([column, value]);
          hoisted.queries.push({ table, column, value });
          return builder;
        }),
        in: vi.fn((column: string, value: unknown[]) => { inclusions.push([column, value]); return builder; }),
        order: vi.fn((column: string, options: { ascending: boolean }) => { orders.push({ column, ascending: options.ascending }); return builder; }),
        limit: vi.fn((value: number) => { hoisted.limits.push({ table, value }); return builder; }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const data = (rows[table] ?? []).filter((row) => equals.every(([column, value]) => row[column] === value)
            && inclusions.every(([column, values]) => values.includes(row[column])));
          data.sort((a, b) => {
            for (const { column, ascending } of orders) {
              if (a[column] === b[column]) continue;
              return ((a[column] as string) < (b[column] as string) ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          return Promise.resolve({ data, error: table === failedTable ? { message: "unavailable" } : null, count: data.length + (table === cappedTable ? 1 : 0) }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { supabase, organisation: { id: ORGANISATION_ID, name: "Active organisation" }, user: { id: "user-1" }, membership: { role } };
}

beforeEach(() => {
  hoisted.queries.length = 0;
  hoisted.selections.length = 0;
  hoisted.limits.length = 0;
  hoisted.requireContext.mockResolvedValue(activeContext());
});

describe("SoA index active organisation scope", () => {
  it("explains that an assessment starts a draft and control applicability still needs review", async () => {
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());
    expect(screen.getByText(/The assessment provides context/)).toHaveTextContent("You still need to review which controls apply and record your reasons.");
    expect(screen.queryByText(/its answers decide which controls apply/)).not.toBeInTheDocument();
  });
  it("does not list sibling assessments, drafts, or snapshots", async () => {
    const { default: SoaPage } = await import("./page");

    render(await SoaPage());

    expect(screen.queryByText("Sibling assessment")).not.toBeInTheDocument();
    expect(screen.queryByText("Sibling draft")).not.toBeInTheDocument();
    expect(screen.queryByText("Sibling snapshot")).not.toBeInTheDocument();
    expect(hoisted.queries).toEqual(expect.arrayContaining([
      { table: "assessment_sessions", column: "organisation_id", value: ORGANISATION_ID },
      { table: "soa_registers", column: "organisation_id", value: ORGANISATION_ID },
      { table: "soa_snapshots", column: "organisation_id", value: ORGANISATION_ID },
    ]));
  });
});


function reviewRows() {
  return {
    assessment_sessions: [{ id: "assessment-1", organisation_id: ORGANISATION_ID, title: "Source assessment", state: "draft", revision: 4, catalogue_version_id: "catalogue-1" }],
    catalogue_versions: [{ id: "catalogue-1", title: "Assessment catalogue", version: "2026.1" }],
    catalogue_questions: [
      { id: "question-1", catalogue_version_id: "catalogue-1" },
      { id: "question-2", catalogue_version_id: "catalogue-1" },
    ],
    assessment_responses: [{ organisation_id: ORGANISATION_ID, session_id: "assessment-1", question_id: "question-1", answer: "yes" }],
    soa_registers: [
      { id: "older", organisation_id: ORGANISATION_ID, assessment_session_id: "assessment-1", title: "Older active review", version: 4, updated_at: "2026-08-18T00:00:00Z", soa_snapshots: [] },
      { id: "recommended", organisation_id: ORGANISATION_ID, assessment_session_id: "assessment-1", title: "Recently edited review", version: 3, updated_at: "2026-09-10T00:00:00Z", soa_snapshots: [] },
      { id: "finalised", organisation_id: ORGANISATION_ID, assessment_session_id: "assessment-1", title: "Finalised review", version: 1, updated_at: "2026-09-11T00:00:00Z", soa_snapshots: [{ id: "snapshot-1" }] },
    ],
    soa_snapshots: [{ id: "snapshot-1", organisation_id: ORGANISATION_ID, soa_register_id: "finalised", assessment_session_id: "assessment-1", title: "Preserved statement", version: 1, finalised_at: "2026-09-11T00:00:00Z" }],
  };
}

describe("connected control review choices", () => {
  it("shows every active duplicate, recommends the most recently edited and separates finalised statements", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows()));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());
    expect(screen.getByRole("heading", { name: "Controls & applicability" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Continue active review" })).toHaveLength(2);
    const recommended = screen.getByText("Recommended").closest("article")!;
    expect(within(recommended).getByRole("link", { name: "Continue active review" })).toHaveAttribute("href", "/app/soa/recommended");
    expect(screen.getByText("Older active review")).toBeInTheDocument();
    expect(screen.queryByText("Finalised review")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review finalised statement" })).toHaveAttribute("href", "/app/soa/finalised");
    expect(screen.getByRole("button", { name: "Create next version" }).closest("form")).toHaveFormValues({ registerId: "finalised" });
    expect(screen.getByRole("button", { name: "Start control review" })).toBeInTheDocument();
  });

  it("presents the programme path and distinguishes working reviews from formal outputs", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows()));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());

    const programme = screen.getByRole("navigation", { name: "Programme steps" });
    expect(within(programme).getByText("Assess current practices")).toBeInTheDocument();
    expect(within(programme).getByText("Review control decisions")).toBeInTheDocument();
    expect(within(programme).getByText("Finalise formal statement")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Active control reviews" })).toBeInTheDocument();
    expect(screen.getByText("Editable working decisions", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Finalised statements" })).toBeInTheDocument();
    expect(screen.getByText("Immutable formal outputs", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "1 of 3 review records are finalised statements" })).toHaveAttribute("aria-valuenow", "1");
  });

  it("describes source assessment state, revision, catalogue and complete answer progress before creation", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows()));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());

    expect(screen.getByRole("option", { name: /Source assessment.*In progress.*revision 4.*1 of 2 answered.*Assessment catalogue 2026\.1/i })).toBeInTheDocument();
    expect(screen.getByText(/Incomplete assessments can provide current context, but their answers do not decide which controls apply/i)).toBeInTheDocument();
  });

  it("uses version to break equal update dates while keeping every duplicate visible", async () => {
    const rows = reviewRows();
    rows.soa_registers[0].updated_at = rows.soa_registers[1].updated_at;
    hoisted.requireContext.mockResolvedValue(activeContext(rows));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());
    expect(within(screen.getByText("Recommended").closest("article")!).getByRole("link", { name: "Continue active review" })).toHaveAttribute("href", "/app/soa/older");
    expect(screen.getAllByRole("link", { name: "Continue active review" })).toHaveLength(2);
  });

  it("lets ordinary members read finalised statements without creation actions", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows(), "member"));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());
    expect(screen.getByRole("link", { name: "Review finalised statement" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create next version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start control review" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link", { name: /Export XLSX|CSV|Download PDF|Download DOCX/ })).toHaveLength(0);
    expect(screen.getByText(/You can open control reviews and finalised statements/i)).toBeInTheDocument();
    expect(screen.queryByText(/download finalised statements/i)).not.toBeInTheDocument();
  });

  it.each(["assessment_sessions", "soa_registers", "soa_snapshots"])("reports failed %s reads without claiming records are missing", async (table) => {
    hoisted.requireContext.mockResolvedValue(activeContext({}, "owner", table));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());
    expect(screen.getByText("Control reviews unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Start with an assessment")).not.toBeInTheDocument();
  });

  it("keeps bounded register history usable when exact totals exceed the displayed rows", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows(), "owner", undefined, "soa_registers"));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());

    expect(screen.queryByText("Control reviews unavailable")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Continue active review" })).toHaveLength(2);
    expect(screen.getByText(/Showing 2 active reviews from the latest 3 of 4 register records/i)).toBeInTheDocument();
    expect(hoisted.selections).toContainEqual({ table: "soa_registers", value: expect.stringContaining("soa_snapshots!soa_snapshots_register_tenant_fk(id)") });
    expect(hoisted.limits).toContainEqual({ table: "soa_registers", value: 50 });
  });

  it("keeps a bounded assessment choice usable and identifies undisplayed sources", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows(), "owner", undefined, "assessment_sessions"));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());

    expect(screen.getByRole("option", { name: /Source assessment.*1 of 2 answered/i })).toBeInTheDocument();
    expect(screen.getByText(/Showing the latest 1 of 2 assessments/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "assessment register" })).toHaveAttribute("href", "/app/assessment");
  });

  it("withholds creation when complete assessment answer counts cannot be verified", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext(reviewRows(), "owner", undefined, "assessment_responses"));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());

    expect(screen.getByRole("alert")).toHaveTextContent("Assessment progress could not be verified");
    expect(screen.queryByRole("button", { name: "Start control review" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Continue active review" })).toHaveLength(2);
  });

  it("keeps bounded assessment and finalised histories visible with exact totals and source links", async () => {
    const rows = reviewRows();
    rows.soa_registers.push({ id: "finalised-2", organisation_id: ORGANISATION_ID, assessment_session_id: "assessment-1", title: "Older finalised review", version: 0, updated_at: "2026-08-01T00:00:00Z", soa_snapshots: [{ id: "snapshot-2" }] });
    hoisted.requireContext.mockResolvedValue(activeContext(rows, "owner", undefined, "soa_snapshots"));
    const { default: SoaPage } = await import("./page");
    render(await SoaPage());

    expect(screen.getByText(/Showing 1 of 2 finalised statements/i)).toBeInTheDocument();
    expect(within(screen.getByText("Preserved statement").closest("article")!).getByRole("link", { name: "Source assessment" })).toHaveAttribute("href", "/app/assessment/assessment-1");
  });
});
