import { NextResponse } from "next/server";

import { buildCollectionDependencies } from "@/features/github/application/collection-deps";
import {
  buildMaterialisationDependencies,
  reconcileApprovedGitHubObservations,
} from "@/features/github/application/materialise-approved-observations";
import { runGitHubCollection } from "@/features/github/application/run-collection";
import { runScheduledGitHubCollection } from "@/features/github/application/scheduled-collection";
import { buildWebhookWorkerDependencies, drainGitHubWebhookDeliveries } from "@/features/github/application/webhook-worker";
import { logError } from "@/lib/observability/logger";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WEBHOOK_DRAIN_DEADLINE_MS = 20_000;
const SCHEDULED_COLLECTION_DEADLINE_MS = 240_000;
const WEBHOOK_CLAIM_LIMIT = 5;
const failedWebhookDrain = { claimed: 0, processed: 0, ignored: 0, failed: 1, ownershipLost: 0 } as const;

function deadlineSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  timer.unref?.();
  return controller.signal;
}

function approvedWorkflowIds(): number[] {
  const raw = process.env.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS ?? "";
  const ids = raw.split(",").map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0);
  if (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length || ids.join(",") !== raw.split(",").map((value) => String(Number(value.trim()))).join(",")) {
    throw new Error("GitHub collection is not configured");
  }
  return ids;
}

export async function POST(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  try {
    const service = createSupabaseServiceClient();
    const deps = buildCollectionDependencies(service, {
      appId: process.env.GITHUB_APP_ID ?? "",
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
      approvedSecurityWorkflowIds: approvedWorkflowIds(),
    });
    let webhooks: Awaited<ReturnType<typeof drainGitHubWebhookDeliveries>>;
    try {
      webhooks = await drainGitHubWebhookDeliveries(buildWebhookWorkerDependencies(service, deps), {
        limit: WEBHOOK_CLAIM_LIMIT,
        signal: deadlineSignal(WEBHOOK_DRAIN_DEADLINE_MS),
      });
    } catch {
      webhooks = failedWebhookDrain;
      try {
        await logError("cron", "GitHub webhook drain failed", undefined, { stage: "webhook_drain" });
      } catch { /* scheduled reconciliation must retain its reserved budget */ }
    }
    const now = new Date();
    const signal = deadlineSignal(SCHEDULED_COLLECTION_DEADLINE_MS);
    const cycle = await runScheduledGitHubCollection({
      collect: (collectionRequest) => runGitHubCollection(deps, collectionRequest),
      reconcile: (scope) => reconcileApprovedGitHubObservations(buildMaterialisationDependencies(service), scope),
      now: () => now,
    }, signal);
    if (cycle.collectionFailed) {
      await logError("cron", "GitHub collection cron failed", undefined, { stage: "collection" });
    }
    if (cycle.materialisationFailed) {
      try {
        await logError("cron", "GitHub materialisation failed", undefined, { stage: "materialisation" });
      } catch { /* the collection result remains authoritative */ }
    }
    return NextResponse.json({
      webhooks,
      collection: cycle.collection,
      materialisation: cycle.materialisation,
      collectionFailed: cycle.collectionFailed,
      collectionHealth: cycle.collectionHealth,
    }, { status: cycle.collectionFailed ? 500 : 200 });
  } catch {
    await logError("cron", "GitHub collection cron failed", undefined, { stage: "collection" });
    return NextResponse.json({ error: "GitHub collection failed" }, { status: 500 });
  }
}
