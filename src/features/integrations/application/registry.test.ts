import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeTicketProvider } from "../domain/provider";
import { githubProvider } from "./github";
import { jiraProvider } from "./jira";
import { resolveTicketProvider } from "./registry";

describe("ticket provider mode routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps sandbox rows on the fake adapter even when the old live flag is set", () => {
    vi.stubEnv("INTEGRATIONS_LIVE", "1");
    expect(resolveTicketProvider({ provider: "github", connectionMode: "sandbox" })).toBe(fakeTicketProvider);
    expect(resolveTicketProvider({ provider: "jira", connectionMode: "sandbox" })).toBe(fakeTicketProvider);
  });

  it("routes OAuth rows to their Nango-backed adapter without a global flag", () => {
    vi.stubEnv("INTEGRATIONS_LIVE", "");
    expect(resolveTicketProvider({ provider: "github", connectionMode: "oauth" })).toBe(githubProvider);
    expect(resolveTicketProvider({ provider: "jira", connectionMode: "oauth" })).toBe(jiraProvider);
  });
});
