import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const DAILY_COLLECTION_REQUIRED_ENV = Object.freeze([
  "AWS_REGION",
  "AWS_DEV_DEPLOY_ROLE_ARN",
  "AWS_DEV_ECR_REGISTRY",
  "AWS_DEV_SERVICE_ARN",
  "AWS_DEV_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AWS_DEV_GITHUB_APP_ID",
  "AWS_DEV_GITHUB_APP_PRIVATE_KEY",
  "AWS_DEV_GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
]);

const shaPattern = /^[0-9a-f]{7,64}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const registryPattern = /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$/;
const collectionCountFields = Object.freeze([
  "installationsChecked",
  "repositoriesChecked",
  "observationsStored",
  "repositoriesFailed",
  "repositoriesDeferred",
  "runsPartial",
]);
const materialisationCountFields = Object.freeze([
  "runsConsidered",
  "materialised",
  "unchanged",
  "awaitingApproval",
  "needsAttention",
]);

export function missingDailyCollectionConfiguration(environment) {
  return DAILY_COLLECTION_REQUIRED_ENV.filter((name) => typeof environment[name] !== "string" || environment[name].trim().length === 0);
}

function isCanonicalHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function invalidDailyCollectionConfiguration(environment) {
  const invalid = missingDailyCollectionConfiguration(environment);
  for (const name of ["AWS_DEV_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    if (typeof environment[name] === "string" && environment[name].trim() && !isCanonicalHttpsOrigin(environment[name].trim())) {
      invalid.push(name);
    }
  }
  return [...new Set(invalid)];
}

function invalidBinding() {
  return new Error("Daily collection image binding is invalid");
}

export function resolveDailyCollectionImageBinding(input) {
  try {
    if (!registryPattern.test(input.registry) || input.repository !== "compliancehub-dev") throw invalidBinding();

    const expectedPrefix = `${input.registry}/${input.repository}@`;
    if (typeof input.imageIdentifier !== "string" || !input.imageIdentifier.startsWith(expectedPrefix)) throw invalidBinding();
    const imageDigest = input.imageIdentifier.slice(expectedPrefix.length);
    if (!digestPattern.test(imageDigest) || input.imageIdentifier !== `${expectedPrefix}${imageDigest}`) throw invalidBinding();

    const liveReleaseSha = input.liveHealth?.releaseSha;
    if (input.liveHealth?.status !== "ok" || typeof liveReleaseSha !== "string" || !shaPattern.test(liveReleaseSha)) throw invalidBinding();
    if (input.databaseHealth?.status !== "ok" || input.databaseHealth?.db !== "ok") throw invalidBinding();

    if (input.eventName === "workflow_dispatch") {
      if (typeof input.expectedReleaseSha !== "string" || !shaPattern.test(input.expectedReleaseSha) || input.expectedReleaseSha !== liveReleaseSha) throw invalidBinding();
    } else if (input.eventName === "schedule") {
      if (input.expectedReleaseSha) throw invalidBinding();
    } else {
      throw invalidBinding();
    }

    if (input.ecrImageDetails?.imageDigest !== imageDigest) throw invalidBinding();
    if (!Array.isArray(input.ecrImageDetails?.imageTags) || !input.ecrImageDetails.imageTags.includes(liveReleaseSha)) throw invalidBinding();

    return {
      imageUri: `${expectedPrefix}${imageDigest}`,
      imageDigest,
      releaseSha: liveReleaseSha,
    };
  } catch {
    throw invalidBinding();
  }
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
}

function hasCounts(value, fields) {
  return value !== null
    && typeof value === "object"
    && fields.every((field) => isCount(value[field]));
}

/** Parse and reconstruct only the count-only collector summary allowed in CI logs. */
export function sanitizeDailyCollectionRunnerLog(log) {
  if (typeof log !== "string") throw new Error("Runner log has no safe summary");
  const finalLine = log.split(/\r?\n/).filter((line) => line.trim().length > 0).at(-1);
  if (!finalLine) throw new Error("Runner log has no safe summary");

  let value;
  try {
    value = JSON.parse(finalLine);
  } catch {
    throw new Error("Runner log has no safe summary");
  }

  if (value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.event !== "github_daily_collection"
    || typeof value.complete !== "boolean"
    || !["healthy", "needs_attention"].includes(value.collectionHealth)
    || typeof value.materialisationFailed !== "boolean"
    || !hasCounts(value.collection, collectionCountFields)
    || !hasCounts(value.materialisation, materialisationCountFields)) {
    throw new Error("Runner log has no safe summary");
  }

  const summary = {
    event: "github_daily_collection",
    complete: value.complete
      && value.collectionHealth === "healthy"
      && value.collection.repositoriesFailed === 0
      && value.collection.repositoriesDeferred === 0
      && value.materialisationFailed === false
      && value.materialisation.needsAttention === 0,
    collectionHealth: value.collectionHealth,
    collection: Object.fromEntries(collectionCountFields.map((field) => [field, value.collection[field]])),
    materialisation: Object.fromEntries(materialisationCountFields.map((field) => [field, value.materialisation[field]])),
    materialisationFailed: value.materialisationFailed,
  };

  return summary;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw invalidBinding();
  }
}

function main() {
  if (process.argv[2] === "--sanitize-runner-log") {
    try {
      const summary = sanitizeDailyCollectionRunnerLog(readFileSync(process.argv[3], "utf8"));
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (!summary.complete) process.exitCode = 1;
    } catch {
      process.stderr.write("Daily GitHub collection returned no safe summary.\n");
      process.exitCode = 1;
    }
    return;
  }

  const invalid = invalidDailyCollectionConfiguration(process.env);
  if (invalid.length > 0) {
    process.stderr.write(`Missing or invalid daily collection configuration: ${invalid.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  if (process.argv[2] === "--check-config") {
    process.stdout.write("Daily collection configuration is present.\n");
    return;
  }

  try {
    const binding = resolveDailyCollectionImageBinding({
      registry: process.env.AWS_DEV_ECR_REGISTRY,
      repository: process.env.ECR_REPOSITORY,
      imageIdentifier: process.env.AWS_DEV_IMAGE_IDENTIFIER,
      liveHealth: parseJson(process.env.AWS_DEV_LIVE_HEALTH_JSON),
      databaseHealth: parseJson(process.env.AWS_DEV_DATABASE_HEALTH_JSON),
      ecrImageDetails: parseJson(process.env.AWS_DEV_ECR_IMAGE_DETAILS_JSON),
      eventName: process.env.COMPLIANCEHUB_EVENT_NAME,
      expectedReleaseSha: process.env.EXPECTED_RELEASE_SHA,
    });
    process.stdout.write(`image_uri=${binding.imageUri}\nimage_digest=${binding.imageDigest}\nrelease_sha=${binding.releaseSha}\n`);
  } catch {
    process.stderr.write("Current AWS dev image could not be safely verified.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
