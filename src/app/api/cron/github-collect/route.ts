import { NextResponse } from "next/server";

import { buildCollectionDependencies } from "@/features/github/application/collection-deps";
import { runGitHubCollection } from "@/features/github/application/run-collection";
import { buildWebhookWorkerDependencies, drainGitHubWebhookDeliveries } from "@/features/github/application/webhook-worker";
import { logError } from "@/lib/observability/logger";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROUTE_DEADLINE_MS = 270_000;

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
    const now = new Date();
    const signal = AbortSignal.timeout(ROUTE_DEADLINE_MS);
    const webhooks = await drainGitHubWebhookDeliveries(buildWebhookWorkerDependencies(service, deps), { limit: 20, signal });
    const collection = await runGitHubCollection(deps, {
      trigger: "scheduled",
      requestKey: `scheduled:${now.toISOString().slice(0, 10)}`,
      signal,
    });
    return NextResponse.json({ webhooks, collection });
  } catch {
    await logError("cron", "GitHub collection cron failed", undefined, { stage: "collection" });
    return NextResponse.json({ error: "GitHub collection failed" }, { status: 500 });
  }
}
