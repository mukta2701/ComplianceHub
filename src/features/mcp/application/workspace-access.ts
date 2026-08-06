import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { McpError } from "../auth/errors";
import { safeSummary } from "../domain/safe-summary";

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
  const { data, error } = await supabase
    .from("memberships")
    .select("organisation_id,role,organisation:organisations!inner(id,name)")
    .eq("user_id", verifiedUserId)
    .order("organisation_id", { ascending: true });
  if (error) throw new McpError("INTERNAL_ERROR");
  const parsed = z.array(workspaceRowSchema).safeParse(data);
  if (!parsed.success) throw new McpError("INTERNAL_ERROR");
  return parsed.data.map((row) => ({
    id: row.organisation_id,
    name: safeSummary(row.organisation.name, 160, "Workspace"),
    role: row.role,
  }));
}

export async function resolveWorkspace(
  supabase: SupabaseClient,
  verifiedUserId: string,
  workspaceId?: string,
): Promise<AccessibleWorkspace> {
  if (workspaceId !== undefined && !z.uuid().safeParse(workspaceId).success) {
    throw new McpError("VALIDATION_ERROR");
  }
  const workspaces = await listWorkspaces(supabase, verifiedUserId);
  if (workspaceId) {
    const selected = workspaces.find(({ id }) => id === workspaceId);
    if (!selected) throw new McpError("FORBIDDEN");
    return selected;
  }
  if (workspaces.length === 0) throw new McpError("NOT_FOUND");
  if (workspaces.length > 1) throw new WorkspaceRequiredError(workspaces);
  return workspaces[0]!;
}
