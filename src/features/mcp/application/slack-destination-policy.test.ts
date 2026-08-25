import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveSlackDestination,
  approveStoredSlackDestination,
} from "./slack-destination-policy";

const WEBHOOK = "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST";
const WEBHOOK_SHA256 = "36b243d5b0e2304cbdf6f5bf362061b4f0e5cdc842c7f407af9253d0207cce52";
const GOV_WEBHOOK = "https://hooks.slack-gov.com/services/T_TEST/B_TEST/S_TEST";
const GOV_WEBHOOK_SHA256 = "5430f2455f30bd64452ca6f7f517ca3e3d74d05151a68355dcb8252fc121cb60";

describe("server-approved Slack destination policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("canonicalizes an official Slack URL before hashing and returns only a bounded approval", () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", WEBHOOK_SHA256);

    expect(approveSlackDestination("HTTPS://HOOKS.SLACK.COM/services/T_TEST/B_TEST/S_TEST"))
      .toEqual({ status: "approved", canonicalUrl: WEBHOOK, webhookSha256: WEBHOOK_SHA256 });
  });

  it("accepts the official Slack Gov host through the same exact policy", () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", GOV_WEBHOOK_SHA256);

    expect(approveSlackDestination(GOV_WEBHOOK))
      .toEqual({ status: "approved", canonicalUrl: GOV_WEBHOOK, webhookSha256: GOV_WEBHOOK_SHA256 });
  });

  it.each([
    ["missing", undefined],
    ["blank", ""],
    ["short", "a".repeat(63)],
    ["long", "a".repeat(65)],
    ["uppercase", WEBHOOK_SHA256.toUpperCase()],
    ["non-hex", `${"a".repeat(63)}g`],
    ["mismatch", "b".repeat(64)],
  ])("fails closed for a %s configured digest", (_label, configured) => {
    if (configured === undefined) vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", undefined);
    else vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", configured);

    expect(approveSlackDestination(WEBHOOK)).toEqual({ status: "not_approved" });
  });

  it.each([
    "http://hooks.slack.com/services/T_TEST/B_TEST/S_TEST",
    "https://127.0.0.1:4444/services/T_TEST/B_TEST/S_TEST",
    "https://hooks.slack.com.evil.test/services/T_TEST/B_TEST/S_TEST",
    "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST?redirect=1",
    "not a URL",
  ])("never treats an unsafe or loopback URL as production-approved: %s", (value) => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", WEBHOOK_SHA256);
    expect(approveSlackDestination(value)).toEqual({ status: "not_approved" });
  });

  it("rejects a missing digest or legacy plaintext envelope before returning a decryptable value", () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", WEBHOOK_SHA256);

    expect(approveStoredSlackDestination({ webhookUrl: WEBHOOK, webhookSha256: WEBHOOK_SHA256 }))
      .toEqual({ status: "not_approved" });
    expect(approveStoredSlackDestination({ webhookUrl: "v1:iv:tag:data" }))
      .toEqual({ status: "not_approved" });
    expect(approveStoredSlackDestination({ webhookUrl: "v1:iv:tag:data", webhookSha256: "b".repeat(64) }))
      .toEqual({ status: "not_approved" });
  });

  it("returns the encrypted envelope only after its exact stored digest is approved", () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", WEBHOOK_SHA256);

    expect(approveStoredSlackDestination({
      webhookUrl: "v1:iv:tag:data",
      webhookSha256: WEBHOOK_SHA256,
      label: "not identity",
    })).toEqual({
      status: "approved",
      encryptedWebhook: "v1:iv:tag:data",
    });
  });

  it("never includes the supplied webhook or configured digest in a rejection decision", () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", "b".repeat(64));
    const decision = approveSlackDestination(WEBHOOK);
    const serialised = JSON.stringify(decision);

    expect(decision).toEqual({ status: "not_approved" });
    expect(serialised).not.toContain(WEBHOOK);
    expect(serialised).not.toContain("b".repeat(64));
  });
});
