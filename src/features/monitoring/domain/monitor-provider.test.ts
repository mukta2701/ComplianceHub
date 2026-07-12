import { describe, expect, it } from "vitest";
import { fakeMonitorProvider } from "./monitor-provider";

const conn = { id: "c1", provider: "github" as const, config: {}, accessToken: "" };

describe("fakeMonitorProvider", () => {
  it("returns a deterministic mix of passing and failing checks", async () => {
    const a = await fakeMonitorProvider.runChecks(conn);
    const b = await fakeMonitorProvider.runChecks(conn);
    expect(a).toEqual(b); // deterministic
    expect(a.length).toBe(6);
    expect(a.filter((c) => !c.passed).length).toBe(3);
    expect(a.some((c) => c.severity === "critical" && !c.passed)).toBe(true);
    // every check maps to an ISO control and a subject
    for (const c of a) { expect(c.controlRef).toMatch(/^A\./); expect(c.subjectId).toBeTruthy(); }
  });

  it("personalises subjects from the connection config", async () => {
    const checks = await fakeMonitorProvider.runChecks({ ...conn, config: { owner: "startech", repo: "isms-repo" } });
    expect(checks.find((c) => c.subjectType === "github_repo")?.subjectId).toBe("startech/isms-repo");
    expect(checks.find((c) => c.subjectType === "github_org")?.subjectId).toBe("startech");
  });
});
