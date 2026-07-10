import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorisedCron } from "./cron-auth";

const req = (auth?: string) => new Request("http://x", auth ? { headers: { authorization: auth } } : undefined);
afterEach(() => vi.unstubAllEnvs());

describe("isAuthorisedCron", () => {
  it("accepts the exact bearer secret and rejects others", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isAuthorisedCron(req("Bearer s3cret"))).toBe(true);
    expect(isAuthorisedCron(req("Bearer nope"))).toBe(false);
    expect(isAuthorisedCron(req())).toBe(false);
  });
  it("rejects everything when the secret is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorisedCron(req("Bearer anything"))).toBe(false);
  });
});
