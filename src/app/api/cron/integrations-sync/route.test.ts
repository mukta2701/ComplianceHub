import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

describe("integrations-sync auth guard", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = "test-secret"; });
  afterEach(() => { process.env.CRON_SECRET = original; });

  it("rejects a request without the bearer secret", async () => {
    const res = await POST(new Request("http://localhost/api/cron/integrations-sync", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong secret", async () => {
    const res = await POST(new Request("http://localhost/api/cron/integrations-sync", { method: "POST", headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });
});
