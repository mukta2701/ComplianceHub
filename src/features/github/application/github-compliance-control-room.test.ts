import { describe, expect, it, vi } from "vitest";

import {
  CONTROL_ROOM_REQUEST_TIMEOUT_MS,
  loadGitHubComplianceControlRoom,
  parseGitHubComplianceControlRoom,
  parseSafeGitHubRepositorySource,
} from "./github-compliance-control-room";

const ORG = "a1000000-0000-4000-8000-000000000001";
const REPOSITORY = "a1000000-0000-4000-8000-000000000101";
const RUN = "a1000000-0000-4000-8000-000000000201";
const JOB = "a1000000-0000-4000-8000-000000000301";
const RESULT = "a1000000-0000-4000-8000-000000000401";
const PACK = "91000000-0000-4000-8000-000000000001";
const EVIDENCE = "a1000000-0000-4000-8000-000000000501";
const FINDING = "a1000000-0000-4000-8000-000000000601";
const CHECKSUM = "b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f";

function validPayload() {
  return {
    schemaVersion: 1,
    workspaceId: ORG,
    asOf: "2026-08-25T07:30:00.000Z",
    approval: {
      mappingPackId: PACK,
      version: "github-iso-27001-v1",
      checksum: CHECKSUM,
      approvedAt: "2026-08-25T06:00:00.000Z",
      revoked: false,
    },
    pagination: { offset: 0, limit: 10, total: 1, truncated: false },
    repositories: [{
      id: REPOSITORY,
      name: "Mukta2701/ComplianceHub",
      url: "https://github.com/Mukta2701/ComplianceHub/",
      visibility: "private",
      defaultBranch: "main",
      archived: false,
      available: true,
      latestCollection: {
        id: RUN,
        status: "partial",
        completedAt: "2026-08-25T07:00:00.000Z",
      },
      latestMaterialisationJob: {
        id: JOB,
        collectionRunId: RUN,
        status: "exhausted",
        attempts: 25,
        availableAt: "2026-08-25T07:00:00.000Z",
        exhaustedAt: "2026-08-25T07:05:00.000Z",
      },
      officialResults: [{
        id: RESULT,
        checkId: "github.repository.visibility",
        outcome: "fail",
        severity: "high",
        summary: "A failed repository visibility observation needs attention.",
        observedAt: "2026-08-25T06:55:00.000Z",
        freshUntil: "2026-08-26T18:55:00.000Z",
        materialisedAt: "2026-08-25T07:01:00.000Z",
        ruleVersion: "github-repository-v1",
        mappingPackId: PACK,
        mappingVersion: "github-iso-27001-v1",
        mappingChecksum: CHECKSUM,
        evidenceId: null,
        findingId: FINDING,
      }],
    }],
    exhaustedAttention: {
      total: 1,
      truncated: false,
      items: [{
        jobId: JOB,
        repositoryId: REPOSITORY,
        collectionRunId: RUN,
        attempts: 25,
        exhaustedAt: "2026-08-25T07:05:00.000Z",
      }],
    },
  };
}

function fakeClient(data: unknown, error: unknown = null) {
  const signals: AbortSignal[] = [];
  const abortSignal = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return Promise.resolve({ data, error });
  });
  const rpc = vi.fn(() => ({ abortSignal }));
  return { client: { rpc }, rpc, abortSignal, signals };
}

describe("safe GitHub repository source", () => {
  it("accepts one canonical GitHub owner/repository pair and removes only a trailing slash", () => {
    expect(parseSafeGitHubRepositorySource({
      name: "Mukta2701/ComplianceHub",
      url: "https://github.com/Mukta2701/ComplianceHub/",
    })).toEqual({
      name: "Mukta2701/ComplianceHub",
      url: "https://github.com/Mukta2701/ComplianceHub",
    });
  });

  it.each([
    ["Mukta2701/ComplianceHub", "http://github.com/Mukta2701/ComplianceHub"],
    ["Mukta2701/ComplianceHub", "https://github.example/Mukta2701/ComplianceHub"],
    ["Mukta2701/ComplianceHub", "https://user:pass@github.com/Mukta2701/ComplianceHub"],
    ["Mukta2701/ComplianceHub", "https://github.com:444/Mukta2701/ComplianceHub"],
    ["Mukta2701/ComplianceHub", "https://github.com/Mukta2701/ComplianceHub?token=x"],
    ["Mukta2701/ComplianceHub", "https://github.com/Mukta2701/ComplianceHub#readme"],
    ["Mukta2701/ComplianceHub", "https://github.com/Mukta2701/Other"],
    ["Mukta2701/ComplianceHub", "https://github.com\\Mukta2701\\ComplianceHub"],
    ["Mukta2701/ComplianceHub", "https://github.com/Mukta2701/x/../ComplianceHub"],
    ["Mukta2701/<script>", "https://github.com/Mukta2701/%3Cscript%3E"],
    ["Mukta_2701/ComplianceHub", "https://github.com/Mukta_2701/ComplianceHub"],
  ])("rejects an unsafe or mismatched source %#", (name, url) => {
    expect(() => parseSafeGitHubRepositorySource({ name, url })).toThrow("Invalid GitHub repository source");
  });
});

describe("GitHub compliance control-room contract", () => {
  it("parses a bounded snapshot and canonicalises the trusted repository URL", () => {
    const parsed = parseGitHubComplianceControlRoom(validPayload(), {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    });

    expect(parsed.repositories[0]?.url).toBe("https://github.com/Mukta2701/ComplianceHub");
    expect(parsed.repositories[0]?.officialResults[0]).toMatchObject({
      checkId: "github.repository.visibility",
      outcome: "fail",
      findingId: FINDING,
    });
    expect(parsed.exhaustedAttention).toEqual(validPayload().exhaustedAttention);
  });

  it("represents an approval-blocked job with no invented availability time", () => {
    const payload = validPayload();
    payload.repositories[0].latestMaterialisationJob = {
      ...payload.repositories[0].latestMaterialisationJob,
      status: "awaiting_approval",
      attempts: 2,
      availableAt: null,
      exhaustedAt: null,
    } as never;
    expect(parseGitHubComplianceControlRoom(payload, {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    }).repositories[0]?.latestMaterialisationJob).toMatchObject({
      status: "awaiting_approval",
      availableAt: null,
    });
  });

  it("retains a retryable job's future backoff time", () => {
    const payload = validPayload();
    payload.repositories[0].latestMaterialisationJob = {
      ...payload.repositories[0].latestMaterialisationJob,
      status: "retryable",
      attempts: 3,
      availableAt: "2026-08-25T07:31:00.000Z",
      exhaustedAt: null,
    } as never;
    expect(parseGitHubComplianceControlRoom(payload, {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    }).repositories[0]?.latestMaterialisationJob).toMatchObject({
      status: "retryable",
      availableAt: "2026-08-25T07:31:00.000Z",
    });
  });

  it("loads only through the authenticated versioned RPC with an abort deadline", async () => {
    const fake = fakeClient(validPayload());

    await expect(loadGitHubComplianceControlRoom(fake.client as never, {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    })).resolves.toMatchObject({ workspaceId: ORG, schemaVersion: 1 });

    expect(fake.rpc).toHaveBeenCalledWith("get_github_compliance_control_room_v1", {
      target_organisation_id: ORG,
      target_offset: 0,
      target_limit: 10,
    });
    expect(fake.abortSignal).toHaveBeenCalledOnce();
    expect(fake.signals[0]?.aborted).toBe(false);
    expect(CONTROL_ROOM_REQUEST_TIMEOUT_MS).toBeLessThan(8_000);
  });

  it.each([
    { organisationId: "not-a-uuid", offset: 0, limit: 10 },
    { organisationId: ORG, offset: -1, limit: 10 },
    { organisationId: ORG, offset: 0, limit: 0 },
    { organisationId: ORG, offset: 0, limit: 21 },
    { organisationId: ORG, offset: 10_001, limit: 10 },
  ])("rejects invalid input before calling Supabase: %#", async (input) => {
    const fake = fakeClient(validPayload());
    await expect(loadGitHubComplianceControlRoom(fake.client as never, input)).rejects.toThrow(
      "Could not load GitHub compliance control room",
    );
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("maps RPC and malformed payload failures to one safe application error", async () => {
    const databaseFailure = fakeClient(null, { message: "relation internal_secret does not exist" });
    await expect(loadGitHubComplianceControlRoom(databaseFailure.client as never, {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    })).rejects.toThrow("Could not load GitHub compliance control room");

    const malformed = fakeClient({ ...validPayload(), rawObservation: { unsafe: true } });
    await expect(loadGitHubComplianceControlRoom(malformed.client as never, {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    })).rejects.toThrow("Could not load GitHub compliance control room");
  });

  it.each([
    ["workspace mismatch", () => ({ ...validPayload(), workspaceId: "b1000000-0000-4000-8000-000000000001" })],
    ["future as-of relation", () => ({ ...validPayload(), asOf: "2026-08-25T06:00:00.000Z" })],
    ["pagination mismatch", () => ({ ...validPayload(), pagination: { offset: 1, limit: 10, total: 1, truncated: false } })],
    ["impossible truncation", () => ({ ...validPayload(), pagination: { offset: 0, limit: 10, total: 2, truncated: false } })],
    ["duplicate repository", () => {
      const payload = validPayload();
      return { ...payload, pagination: { offset: 0, limit: 10, total: 2, truncated: false }, repositories: [payload.repositories[0], payload.repositories[0]] };
    }],
    ["duplicate result", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], officialResults: [payload.repositories[0].officialResults[0], payload.repositories[0].officialResults[0]] }] };
    }],
    ["unsafe summary", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], officialResults: [{ ...payload.repositories[0].officialResults[0], summary: "<script>alert(1)</script>" }] }] };
    }],
    ["outcome severity mismatch", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], officialResults: [{ ...payload.repositories[0].officialResults[0], outcome: "pass", evidenceId: EVIDENCE }] }] };
    }],
    ["wrong result reference", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], officialResults: [{ ...payload.repositories[0].officialResults[0], outcome: "unknown", severity: null, findingId: FINDING }] }] };
    }],
    ["exhausted job below its terminal attempt ceiling", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], latestMaterialisationJob: { ...payload.repositories[0].latestMaterialisationJob, attempts: 24 } }] };
    }],
    ["invented approval-blocked availability", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], latestMaterialisationJob: { ...payload.repositories[0].latestMaterialisationJob, status: "awaiting_approval", exhaustedAt: null } }] };
    }],
    ["raw provider body", () => {
      const payload = validPayload();
      return { ...payload, repositories: [{ ...payload.repositories[0], providerRepositoryId: 123, rawProviderResponse: {} }] };
    }],
    ["member identity", () => ({ ...validPayload(), approvedBy: "a1000000-0000-4000-8000-000000000999" })],
    ["unbounded attention", () => {
      const payload = validPayload();
      return { ...payload, exhaustedAttention: { total: 21, truncated: false, items: Array.from({ length: 21 }, () => payload.exhaustedAttention.items[0]) } };
    }],
  ])("rejects %s", (_label, mutate) => {
    expect(() => parseGitHubComplianceControlRoom(mutate(), {
      organisationId: ORG,
      offset: 0,
      limit: 10,
    })).toThrow("Could not load GitHub compliance control room");
  });

  it("accepts an empty page beyond the selected repository count without inventing truncation", () => {
    const payload = validPayload();
    const empty = {
      ...payload,
      pagination: { offset: 20, limit: 10, total: 1, truncated: false },
      repositories: [],
    };
    expect(parseGitHubComplianceControlRoom(empty, {
      organisationId: ORG,
      offset: 20,
      limit: 10,
    }).repositories).toEqual([]);
  });
});
