"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { buildCollectionDependencies } from "@/features/github/application/collection-deps";
import {
  buildMaterialisationDependencies,
  reconcileApprovedGitHubObservations,
  type ReconciliationSummary,
} from "@/features/github/application/materialise-approved-observations";
import {
  runGitHubCollection,
  type CollectionSummary,
} from "@/features/github/application/run-collection";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const installationSchema = z.object({ installationId: z.uuid() }).strict();
const collectionSummarySchema = z.object({
  installationsChecked: z.number().int().nonnegative(),
  repositoriesChecked: z.number().int().nonnegative(),
  observationsStored: z.number().int().nonnegative(),
  repositoriesFailed: z.number().int().nonnegative(),
  repositoriesDeferred: z.number().int().nonnegative(),
  runsPartial: z.number().int().nonnegative(),
  terminalRuns: z.array(z.object({
    collectionRunId: z.uuid(),
    organisationId: z.uuid(),
    installationId: z.uuid(),
    repositoryId: z.uuid(),
    providerRepositoryId: z.number().int().positive().safe(),
    status: z.enum(["succeeded", "partial"]),
  }).strict()).max(10_000),
}).strict();

export type GitHubOfficialRecheckResult = {
  ok: boolean;
  message: string;
  summary?: CollectionSummary;
  materialisation?: ReconciliationSummary;
};

const failure = {
  ok: false,
  message: "Could not run this official GitHub recheck. Please try again.",
} as const;

function approvedSecurityWorkflowIds(): number[] {
  const values = (process.env.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS ?? "")
    .split(",")
    .map((value) => value.trim());
  if (values.length < 1 || values.length > 20 || values.some((value) => !/^[1-9][0-9]*$/.test(value))) {
    throw new Error("GitHub collection is not configured");
  }
  const ids = values.map(Number);
  if (ids.some((value) => !Number.isSafeInteger(value)) || new Set(ids).size !== ids.length) {
    throw new Error("GitHub collection is not configured");
  }
  return ids;
}

export async function recheckGitHubInstallationAction(
  formData: FormData,
): Promise<GitHubOfficialRecheckResult> {
  try {
    const { supabase, user, organisation, membership } = await requireAppContext();
    if (membership.role !== "owner") return failure;
    const parsed = installationSchema.parse(Object.fromEntries(formData));
    const { data: installation, error } = await supabase.from("github_installations")
      .select("id,status,permissions_ok,repository_selection")
      .eq("id", parsed.installationId)
      .eq("organisation_id", organisation.id)
      .maybeSingle();
    if (error
      || !installation
      || installation.id !== parsed.installationId
      || installation.status !== "active"
      || installation.permissions_ok !== true
      || installation.repository_selection !== "selected") {
      return failure;
    }

    await enforceRateLimit(`github-manual:${organisation.id}:${user.id}`, { limit: 5, windowMs: 60_000 });
    const appId = process.env.GITHUB_APP_ID?.trim() ?? "";
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
    if (!appId || !privateKey) return failure;
    const service = createSupabaseServiceClient();
    const dependencies = buildCollectionDependencies(service, {
      appId,
      privateKey,
      approvedSecurityWorkflowIds: approvedSecurityWorkflowIds(),
    });
    const summary = collectionSummarySchema.parse(await runGitHubCollection(dependencies, {
      trigger: "manual",
      runMode: "official",
      installationId: parsed.installationId,
      requestKey: `manual:${randomUUID()}`,
    }));
    let materialisation: ReconciliationSummary;
    try {
      materialisation = await reconcileApprovedGitHubObservations(
        buildMaterialisationDependencies(service),
        { limit: 100, terminalRuns: summary.terminalRuns },
      );
    } catch {
      materialisation = {
        runsConsidered: 0,
        materialised: 0,
        unchanged: 0,
        awaitingApproval: 0,
        needsAttention: 1,
      };
    }

    revalidatePath("/app/monitoring");
    revalidatePath("/app/evidence");
    revalidatePath("/app");
    const counts = `${summary.repositoriesChecked} checked, ${summary.repositoriesDeferred} deferred, ${summary.repositoriesFailed} failed.`;
    return {
      ok: true,
      message: materialisation.needsAttention > 0
        ? `Official GitHub recheck finished, but ComplianceHub records need attention: ${counts}`
        : materialisation.awaitingApproval > 0
          ? `Official GitHub recheck finished; official records await Owner approval: ${counts}`
          : `Official GitHub recheck finished: ${counts}`,
      summary,
      materialisation,
    };
  } catch {
    return failure;
  }
}
