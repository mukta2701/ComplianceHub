import { beforeEach,describe,expect,it,vi } from "vitest";

const state = vi.hoisted(() => ({ token:crypto.randomUUID() as string|null,role:"owner" }));
const query = vi.hoisted(() => {
  const chain:Record<string,unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data:{ id:"audit-1" },error:null });
  return chain;
});

vi.mock("next/headers",() => ({ cookies:() => Promise.resolve({ get:() => state.token ? { value:state.token } : undefined }) }));
vi.mock("@/lib/app-context",() => ({ requireAppContext:() => Promise.resolve({ supabase:{ from:() => query },organisation:{ id:"org-1" },membership:{ role:state.role } }) }));
vi.mock("@/features/audits/application/auditor-token",() => ({ AUDITOR_LINK_FLASH_COOKIE:"auditor_link_flash" }));

import { GET } from "./route";

describe("one-time auditor link delivery",() => {
  beforeEach(() => { state.token = crypto.randomUUID(); state.role = "owner"; });

  it("returns the raw link without caching and expires the scoped cookie",async () => {
    const response = await GET(new Request("http://localhost"),{ params:Promise.resolve({ id:"audit-1" }) });
    await expect(response.json()).resolves.toEqual({ link:`/audit-view/${state.token}` });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("auditor_link_flash=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/app/audits/audit-1/auditor-link");
  });

  it("returns no credential when the one-time cookie is absent",async () => {
    state.token = null;
    const response = await GET(new Request("http://localhost"),{ params:Promise.resolve({ id:"audit-1" }) });
    await expect(response.json()).resolves.toEqual({ link:null });
  });

  it("does not expose the credential to a Member",async () => {
    state.role = "member";
    const response = await GET(new Request("http://localhost"),{ params:Promise.resolve({ id:"audit-1" }) });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ link:null });
  });
});
