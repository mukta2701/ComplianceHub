import { describe, expect, it, vi } from "vitest";

import { READ_PERMISSIONS } from "./github-app-auth";
import { claimInstallation, type VerifiedInstallationClaim } from "./installation-claim";

const verified: VerifiedInstallationClaim = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  requestedInstallationId: 77,
  userInstallationIds: [77, 88],
  appInstallation: {
    id: 77,
    account: { id: 99, login: "Adtecher", type: "Organization" },
    repositorySelection: "selected",
    permissions: { ...READ_PERMISSIONS },
    suspendedAt: null,
  },
  repositories: [{
    id: 101, owner: "adtecher", name: "portal", fullName: "adtecher/portal",
    htmlUrl: "https://evil.example/spoof", visibility: "private", archived: false, defaultBranch: "main",
  }],
};

describe("claimInstallation", () => {
  it("persists only a triple-verified canonical Organization claim", async () => {
    const persist = vi.fn().mockResolvedValue("installation-uuid");
    await expect(claimInstallation(verified, { allowedAccountId: 99, persist })).resolves.toBe("installation-uuid");
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      requestedInstallationId: 77,
      accountId: 99,
      permissions: READ_PERMISSIONS,
      repositories: [expect.objectContaining({ htmlUrl: "https://github.com/adtecher/portal" })],
    }));
  });

  it("persists a verified configured personal installation claim", async () => {
    const persist = vi.fn().mockResolvedValue("installation-uuid");
    const personal: VerifiedInstallationClaim = {
      ...verified,
      appInstallation: {
        ...verified.appInstallation,
        account: { id: 61040544, login: "mukta2701", type: "User" },
      },
      repositories: [{
        id: 102,
        owner: "mukta2701",
        name: "ComplianceHub",
        fullName: "mukta2701/ComplianceHub",
        htmlUrl: "https://evil.example/spoof",
        visibility: "private",
        archived: false,
        defaultBranch: "main",
      }],
    };

    await expect(claimInstallation(personal, {
      allowedAccountId: 61040544,
      allowedAccountType: "User",
      persist,
    })).resolves.toBe("installation-uuid");
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 61040544,
      accountType: "User",
      repositories: [expect.objectContaining({
        htmlUrl: "https://github.com/mukta2701/ComplianceHub",
      })],
    }));
  });

  it("rejects an installation whose account type does not match configuration", async () => {
    const persist = vi.fn();
    await expect(claimInstallation(verified, {
      allowedAccountId: 99,
      allowedAccountType: "User",
      persist,
    })).rejects.toThrow("GitHub installation verification failed");
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    ["not visible to user", { userInstallationIds: [88] }],
    ["app id mismatch", { appInstallation: { ...verified.appInstallation, id: 78 } }],
    ["all repositories", { appInstallation: { ...verified.appInstallation, repositorySelection: "all" } }],
    ["personal account", { appInstallation: { ...verified.appInstallation, account: { ...verified.appInstallation.account, type: "User" } } }],
    ["wrong account", { appInstallation: { ...verified.appInstallation, account: { ...verified.appInstallation.account, id: 100 } } }],
    ["suspended", { appInstallation: { ...verified.appInstallation, suspendedAt: "2026-08-17T12:00:00Z" } }],
    ["broader permissions", { appInstallation: { ...verified.appInstallation, permissions: { ...READ_PERMISSIONS, contents: "read" } } }],
    ["weaker permissions", { appInstallation: { ...verified.appInstallation, permissions: { ...READ_PERMISSIONS, administration: "write" } } }],
  ])("rejects %s before persistence", async (_label, patch) => {
    const persist = vi.fn();
    const claim = { ...verified, ...patch } as VerifiedInstallationClaim;
    await expect(claimInstallation(claim, { allowedAccountId: 99, persist })).rejects.toThrow("GitHub installation verification failed");
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects non-canonical or duplicate repository inventory", async () => {
    const persist = vi.fn();
    for (const repositories of [
      [{ ...verified.repositories[0], owner: "other" }],
      [{ ...verified.repositories[0], fullName: "adtecher/other" }],
      [{ ...verified.repositories[0], archived: "yes" as unknown as boolean }],
      [verified.repositories[0], { ...verified.repositories[0] }],
      Array.from({ length: 101 }, (_, index) => ({ ...verified.repositories[0], id: index + 1, name: `repo-${index}`, fullName: `adtecher/repo-${index}` })),
    ]) {
      await expect(claimInstallation({ ...verified, repositories }, { allowedAccountId: 99, persist })).rejects.toThrow("GitHub installation verification failed");
    }
    expect(persist).not.toHaveBeenCalled();
  });

  it("maps transactional persistence failures to a fixed error", async () => {
    const providerDetail = crypto.randomUUID();
    const persist = vi.fn().mockRejectedValue(new Error(providerDetail));
    const error = await claimInstallation(verified, { allowedAccountId: 99, persist }).catch((value: unknown) => value);
    expect(String(error)).toBe("Error: GitHub installation claim failed");
    expect(String(error)).not.toContain(providerDetail);
  });
});
