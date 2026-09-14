import { afterEach, describe, expect, it, vi } from "vitest";
import { githubEvidenceProvider } from "./github-evidence";
import { googleWorkspaceEvidenceProvider } from "./google-workspace-evidence";
import { resolveEvidenceProvider } from "./evidence-registry";

const originalLive = process.env.EVIDENCE_LIVE;
afterEach(() => { process.env.EVIDENCE_LIVE = originalLive; });

describe("live evidence providers", () => {
  it("turns GitHub protected-branch metadata into one evidence record without fetching repository contents", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ name: "main", protected: true }, { name: "release", protected: true }]), { status: 200 }));
    const items = await githubEvidenceProvider.collect({ id: "source-1", provider: "github", config: { owner: "acme", repo: "platform" }, accessToken: "token" }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/acme/platform/branches?protected=true&per_page=100&page=1", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }));
    expect(items).toEqual([expect.objectContaining({ externalRef: "github:acme/platform:protected-branches", title: "GitHub protected branches: acme/platform", kind: "note", note: "2 protected branches reported. Repository contents and branch names were not collected." })]);
  });

  it("aggregates Google Workspace login activity without retaining user or event details", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: { time: "2026-07-10T10:00:00Z" }, actor: { email: "person@example.com" } }, { id: { time: "2026-07-09T10:00:00Z" } }] }), { status: 200 }));
    const items = await googleWorkspaceEvidenceProvider.collect({ id: "source-2", provider: "google_workspace", config: { domain: "acme.com", asOf: "2026-07-10" }, accessToken: "token" }, fetcher);

    expect(items).toEqual([expect.objectContaining({ externalRef: "google_workspace:acme.com:login-activity", title: "Google Workspace login activity summary: acme.com", kind: "note", note: "2 login activity records were observed. User identities and event details were not retained." })]);
    expect(JSON.stringify(items)).not.toContain("person@example.com");
    expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toContain("fields=items%28id%2Ftime%29%2CnextPageToken");
  });

  it("fails closed for AWS instead of returning sandbox evidence when live collection is enabled", async () => {
    process.env.EVIDENCE_LIVE = "1";
    await expect(resolveEvidenceProvider("aws").collect({ id: "source-3", provider: "aws", config: { account: "123", region: "eu-west-2" }, accessToken: "token" })).rejects.toThrow(/SigV4/i);
  });
});
