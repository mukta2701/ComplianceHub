import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ context: null as unknown, updated: vi.fn(), filters: [] as Array<[string, unknown]>, emptyWrite: false, readError: false, writeError: false }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => state.context }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
import { approvePolicyAction, setPolicyStatusAction, updatePolicyAction } from "./actions";

const policyId = "78000000-0000-4000-8000-000000000001";
const organisationId = "78000000-0000-4000-8000-000000000003";
function form(extra: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key,value] of Object.entries({ id:policyId, reference:"POL-001",title:"Security policy",body:"Original content",ownerId:"",reviewDue:"",expectedVersion:"4",expectedRevision:"8",...extra })) result.set(key,value);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks(); state.filters=[]; state.emptyWrite=false; state.readError=false; state.writeError=false;
  state.context = { user:{id:policyId},organisation:{id:organisationId},membership:{role:"owner"},supabase:{
    rpc:vi.fn().mockResolvedValue({error:null}),
    from: () => {
      let writing=false;
      const filters:Array<[string,unknown]>=[];
      const result=()=>({data:writing ? state.emptyWrite || filters.some(([key,value])=>key==="edit_revision" && value!==8) ? null : {version:4,edit_revision:9} : {id:policyId,body:"Original content",version:4,edit_revision:8,owner_id:null},error:(writing ? state.writeError : state.readError) ? {message:"private database detail"} : null});
      const builder={
        select:()=>builder,
        update:(value:unknown)=>{writing=true;state.updated(value);return builder;},
        eq:(key:string,value:unknown)=>{filters.push([key,value]);state.filters.push([key,value]);return builder;},
        single:async()=>result(),maybeSingle:async()=>result(),
        then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve),
      }; return builder;
    },
  }};
});

describe("policy technical edit revisions", () => {
  it("rejects an older metadata draft even when the content version has not changed", async () => {
    await expect(updatePolicyAction(form({expectedRevision:"7"}))).rejects.toThrow("This policy changed");
    expect(state.updated).not.toHaveBeenCalled();
  });
  it.each([approvePolicyAction, setPolicyStatusAction])("rejects stale approval or status decisions", async (action) => {
    await expect(action(form({expectedRevision:"7",status:"archived"}))).rejects.toThrow("This policy changed");
  });
  it("does not approve through the generic status action", async () => {
    await expect(setPolicyStatusAction(form({status:"approved"}))).rejects.toThrow("Invalid policy status");
    expect(state.updated).not.toHaveBeenCalled();
  });
  it.each([updatePolicyAction,approvePolicyAction,setPolicyStatusAction])("rejects an update that loses its atomic revision match", async (action) => {
    state.emptyWrite=true;
    await expect(action(form({status:"archived"}))).rejects.toThrow("This policy changed");
    expect(state.filters).toContainEqual(["organisation_id",organisationId]);
    expect(state.filters).toContainEqual(["edit_revision",8]);
    expect(state.filters).toContainEqual(["version",4]);
  });
  it("returns the database-confirmed technical revision alongside the unchanged content version", async () => {
    await expect(updatePolicyAction(form())).resolves.toEqual({version:4,revision:9});
    expect(state.updated.mock.calls[0][0]).not.toHaveProperty("edit_revision");
  });
  it("does not attempt a write when the current policy cannot be read", async () => {
    state.readError=true;
    await expect(updatePolicyAction(form())).rejects.toThrow("Could not load the policy before saving");
    expect(state.updated).not.toHaveBeenCalled();
  });
  it.each([updatePolicyAction,approvePolicyAction,setPolicyStatusAction])("rejects Member decisions before any write", async (action) => {
    (state.context as {membership:{role:string}}).membership.role="member";
    await expect(action(form({status:"archived"}))).rejects.toThrow("Only workspace operators can manage policies");
    expect(state.updated).not.toHaveBeenCalled();
  });
  it.each([updatePolicyAction,approvePolicyAction,setPolicyStatusAction])("does not report a failed write as saved", async (action) => {
    state.writeError=true;
    await expect(action(form({status:"archived"}))).rejects.toThrow(/Could not (update|approve)/);
  });
});
