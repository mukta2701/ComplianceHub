import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ctx:null as unknown,
  enforceRateLimit:vi.fn(),
  revalidatePath:vi.fn(),
  redirect:vi.fn(),
  setCookie:vi.fn(),
  credential:crypto.randomUUID(),
  digest:crypto.randomUUID(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext:() => Promise.resolve(state.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit:state.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath:state.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect:state.redirect }));
vi.mock("next/headers", () => ({ cookies:() => Promise.resolve({ set:state.setCookie }) }));
vi.mock("@/features/audits/application/auditor-token", () => ({ AUDITOR_LINK_FLASH_COOKIE:"auditor_link_flash",mintAuditorToken:() => ({ rawToken:state.credential,tokenHash:state.digest,expiresAt:"2026-10-01T00:00:00.000Z" }) }));

import { mintAuditorTokenAction, revokeAuditorTokenAction } from "./share-actions";

const auditId = "00000000-0000-4000-8000-000000000001";
function form(values:Record<string,string>) { const data = new FormData(); for (const [key,value] of Object.entries(values)) data.set(key,value); return data; }

describe("auditor share action boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); state.enforceRateLimit.mockResolvedValue(undefined); });

  it("rejects Members before rate-limit or database work", async () => {
    const from = vi.fn();
    state.ctx = { supabase:{from},user:{id:"user-1"},organisation:{id:"org-1"},membership:{role:"member"} };
    await expect(mintAuditorTokenAction(form({ auditId,scope:"audit",expiresInDays:"14" }))).rejects.toThrow("Only workspace operators can manage auditor access");
    await expect(revokeAuditorTokenAction(form({ auditId,id:"token-1" }))).rejects.toThrow("Only workspace operators can manage auditor access");
    expect(state.enforceRateLimit).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an unknown share scope rather than widening it to the organisation", async () => {
    state.ctx = { supabase:{from:vi.fn()},user:{id:"user-1"},organisation:{id:"org-1"},membership:{role:"owner"} };
    await expect(mintAuditorTokenAction(form({ auditId,scope:"unexpected",expiresInDays:"14" }))).rejects.toThrow("Invalid auditor link scope");
  });

  it("rejects a stale revoke request when no token was changed", async () => {
    const query:Record<string,unknown> = {};
    query.eq = vi.fn(() => query); query.or = vi.fn(() => query); query.select = vi.fn(() => query); query.maybeSingle = vi.fn().mockResolvedValue({ data:null,error:null });
    state.ctx = { supabase:{from:vi.fn(() => ({ update:vi.fn(() => query) }))},user:{id:"user-1"},organisation:{id:"org-1"},membership:{role:"owner"} };
    await expect(revokeAuditorTokenAction(form({ auditId,id:"missing-token" }))).rejects.toThrow("Could not revoke the auditor link");
    expect(query.or).toHaveBeenCalledWith(`audit_id.eq.${auditId},audit_id.is.null`);
  });

  it("lets an Owner create an audit-scoped link with a one-time cookie", async () => {
    const insert = vi.fn().mockResolvedValue({ error:null });
    const auditQuery:Record<string,unknown> = {};
    auditQuery.select = vi.fn(() => auditQuery); auditQuery.eq = vi.fn(() => auditQuery); auditQuery.maybeSingle = vi.fn().mockResolvedValue({ data:{ id:auditId,framework:"SOC 2 Type II" },error:null });
    state.ctx = {
      supabase:{ from:vi.fn((table:string) => table === "audits" ? auditQuery : { insert }) },
      user:{ id:"user-1" },
      organisation:{ id:"org-1" },
      membership:{ role:"owner" },
    };

    await mintAuditorTokenAction(form({ auditId,scope:"audit",expiresInDays:"14",label:"ISO auditor" }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      organisation_id:"org-1",
      audit_id:auditId,
      framework:"SOC 2 Type II",
      label:"ISO auditor",
      created_by:"user-1",
      token_hash:state.digest,
    }));
    expect(auditQuery.select).toHaveBeenCalledWith("id,framework");
    expect(state.setCookie).toHaveBeenCalledWith("auditor_link_flash", state.credential, expect.objectContaining({ httpOnly:true,maxAge:60,path:`/api/app/audits/${auditId}/auditor-link` }));
    expect(state.revalidatePath).toHaveBeenCalledWith(`/app/audits/${auditId}`);
    expect(state.redirect).toHaveBeenCalledWith(`/app/audits/${auditId}`);
  });

  it("labels a whole-workspace link neutrally when it is created from a custom-framework audit", async () => {
    const insert = vi.fn().mockResolvedValue({ error:null });
    const auditQuery:Record<string,unknown> = {};
    auditQuery.select = vi.fn(() => auditQuery); auditQuery.eq = vi.fn(() => auditQuery); auditQuery.maybeSingle = vi.fn().mockResolvedValue({ data:{ id:auditId,framework:"SOC 2 Type II" },error:null });
    state.ctx = {
      supabase:{ from:vi.fn((table:string) => table === "audits" ? auditQuery : { insert }) },
      user:{ id:"user-1" },
      organisation:{ id:"org-1" },
      membership:{ role:"owner" },
    };

    await mintAuditorTokenAction(form({ auditId,scope:"org",expiresInDays:"14" }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      audit_id:null,
      framework:"Workspace readiness",
    }));
  });
});
