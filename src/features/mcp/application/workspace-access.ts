import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { McpError } from "../auth/errors";
import { safeSummary } from "../domain/safe-summary";
import { fetchAllPages } from "./read-services";

const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);
const workspaceRowSchema = z.object({
  organisation_id: z.uuid(),
  role: workspaceRoleSchema,
  organisation: z.union([
    z.object({ id: z.uuid(), name: z.string() }),
    z.array(z.object({ id: z.uuid(), name: z.string() })).min(1).max(1).transform((items) => items[0]!),
  ]),
});

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type AccessibleWorkspace = { id: string; name: string; role: WorkspaceRole };

function parseWorkspaceRow(value: unknown): AccessibleWorkspace {
  const parsed = workspaceRowSchema.safeParse(value);
  if (!parsed.success || parsed.data.organisation.id !== parsed.data.organisation_id) throw new McpError("INTERNAL_ERROR");
  return { id: parsed.data.organisation_id, name: safeSummary(parsed.data.organisation.name, 160, "Workspace"), role: parsed.data.role };
}

export class WorkspaceRequiredError extends McpError {
  readonly choices: Array<{ id: string; name: string }>;

  constructor(workspaces: readonly AccessibleWorkspace[]) {
    super("WORKSPACE_REQUIRED");
    this.choices = workspaces.map(({ id, name }) => ({ id, name }));
  }

  override toStructuredContent() {
    const content = super.toStructuredContent();
    return { ...content, error: { ...content.error, choices: this.choices } };
  }
}

export async function listWorkspaces(
  supabase: SupabaseClient,
  verifiedUserId: string,
): Promise<AccessibleWorkspace[]> {
  if (!z.uuid().safeParse(verifiedUserId).success) throw new McpError("INVALID_TOKEN");
  const rows = await fetchAllPages((from, to) => supabase.from("memberships")
    .select("organisation_id,role,organisation:organisations!inner(id,name)")
    .eq("user_id", verifiedUserId)
    .order("organisation_id", { ascending: true })
    .range(from, to));
  return rows.map(parseWorkspaceRow);
}

export async function resolveWorkspace(
  supabase: SupabaseClient,
  verifiedUserId: string,
  workspaceId?: string,
): Promise<AccessibleWorkspace> {
  if (!z.uuid().safeParse(verifiedUserId).success) throw new McpError("INVALID_TOKEN");
  if (workspaceId !== undefined && !z.uuid().safeParse(workspaceId).success) {
    throw new McpError("VALIDATION_ERROR");
  }
  if (workspaceId) {
    const result = await supabase.from("memberships")
      .select("organisation_id,role,organisation:organisations!inner(id,name)")
      .eq("user_id", verifiedUserId)
      .eq("organisation_id", workspaceId)
      .maybeSingle();
    if (result.error) throw new McpError("INTERNAL_ERROR");
    if (!result.data) throw new McpError("FORBIDDEN");
    return parseWorkspaceRow(result.data);
  }
  const workspaces = await listWorkspaces(supabase, verifiedUserId);
  if (workspaces.length === 0) throw new McpError("NOT_FOUND");
  if (workspaces.length > 1) throw new WorkspaceRequiredError(workspaces);
  return workspaces[0]!;
}
