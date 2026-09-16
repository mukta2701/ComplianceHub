import path from "node:path";
import { pathToFileURL } from "node:url";

export type AwsStagingContract = {
  awsAccountId: string;
  awsProductionAccountId: string;
  awsRegion: string;
  ecrRepository: string;
  ecsCluster: string;
  webServiceName: string;
  webTaskFamily: string;
  reconciliationTaskFamily: string;
  privateSubnetIds: string[];
  webSecurityGroupId: string;
  runnerSecurityGroupId: string;
  runnerUsesPublicSubnet: boolean;
  loadBalancerListenerArn: string;
  loadBalancerTargetGroupArn: string;
  stagingHttpsOrigin: string;
  route53AcmDecision: string;
  webRoleArn: string;
  runnerRoleArn: string;
  schedulerRoleArn: string;
  deployRoleArn: string;
  githubOidcSubject: string;
  secretsManagerArns: string[];
  kmsKeyArn: string;
  cloudWatchLogGroups: string[];
  logRetentionDays: number;
  eventBridgeScheduleName: string;
  eventBridgeTimeZone: string;
  eventBridgeCadence: string;
  schedulerDlqArn: string;
  alarmDestinationArn: string;
  slackComplianceDestination: string;
  budgetOwner: string;
  budgetThresholdGbp: number;
  supabaseEgressApproved: boolean;
  rollbackOwner: string;
  allowedIacCiPath: string;
};

export type ContractValidation = {
  ok: boolean;
  errors: string[];
};

export function buildValidStagingContract(): AwsStagingContract {
  return {
    awsAccountId: "111122223333",
    awsProductionAccountId: "999988887777",
    awsRegion: "eu-west-2",
    ecrRepository:
      "111122223333.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-staging",
    ecsCluster: "compliancehub-staging-cluster",
    webServiceName: "compliancehub-web-staging",
    webTaskFamily: "compliancehub-web-staging",
    reconciliationTaskFamily: "compliancehub-reconcile-staging",
    privateSubnetIds: ["subnet-0a1b2c3d4e5f60718", "subnet-1a2b3c4d5e6f70819"],
    webSecurityGroupId: "sg-0a1b2c3d4e5f60718",
    runnerSecurityGroupId: "sg-1a2b3c4d5e6f70819",
    runnerUsesPublicSubnet: false,
    loadBalancerListenerArn:
      "arn:aws:elasticloadbalancing:eu-west-2:111122223333:listener/app/compliancehub-staging/abc123/def456",
    loadBalancerTargetGroupArn:
      "arn:aws:elasticloadbalancing:eu-west-2:111122223333:targetgroup/compliancehub-staging/abc123def456",
    stagingHttpsOrigin: "https://compliancehub-staging.example.com",
    route53AcmDecision:
      "route53 hosted zone in company account / ACM staging cert in eu-west-2 with auto-renew",
    webRoleArn: "arn:aws:iam::111122223333:role/compliancehub-staging-web",
    runnerRoleArn:
      "arn:aws:iam::111122223333:role/compliancehub-staging-runner",
    schedulerRoleArn:
      "arn:aws:iam::111122223333:role/compliancehub-staging-scheduler",
    deployRoleArn:
      "arn:aws:iam::111122223333:role/compliancehub-staging-deploy",
    githubOidcSubject: "repo:example-org/ComplianceHub:ref:refs/heads/main",
    secretsManagerArns: [
      "arn:aws:secretsmanager:eu-west-2:111122223333:secret:compliancehub/staging/github-AbCd12",
      "arn:aws:secretsmanager:eu-west-2:111122223333:secret:compliancehub/staging/app-XyZ987",
    ],
    kmsKeyArn:
      "arn:aws:kms:eu-west-2:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab",
    cloudWatchLogGroups: [
      "/aws/ecs/compliancehub-staging-web",
      "/aws/ecs/compliancehub-staging-runner",
      "/aws/scheduler/compliancehub-staging",
    ],
    logRetentionDays: 90,
    eventBridgeScheduleName: "compliancehub-staging-reconcile",
    eventBridgeTimeZone: "Europe/London",
    eventBridgeCadence: "rate(1 hour)",
    schedulerDlqArn:
      "arn:aws:sqs:eu-west-2:111122223333:compliancehub-staging-dlq",
    alarmDestinationArn:
      "arn:aws:sns:eu-west-2:111122223333:compliancehub-staging-alarms",
    slackComplianceDestination: "C0123456789AB - #compliance-staging (private)",
    budgetOwner: "security@example.com",
    budgetThresholdGbp: 200,
    supabaseEgressApproved: true,
    rollbackOwner: "security@example.com",
    allowedIacCiPath: "in-repo:.github/workflows/deploy-aws-staging.yml",
  };
}

const ACCOUNT_RE = /^\d{12}$/;
const REGION_RE = /^[a-z]{2}-[a-z]+-\d$/;
const ECR_RE =
  /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9-_./]+$/i;
const SUBNET_RE = /^subnet-[a-f0-9]+$/i;
const SG_RE = /^sg-[a-f0-9]+$/i;
const IAM_ROLE_RE = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@/_-]+$/;
const SECRETS_RE =
  /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;
const KMS_RE = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]+$/i;
const ELB_LISTENER_RE =
  /^arn:aws:elasticloadbalancing:[a-z0-9-]+:\d{12}:listener\/.+/;
const ELB_TG_RE =
  /^arn:aws:elasticloadbalancing:[a-z0-9-]+:\d{12}:targetgroup\/.+/;
const DLQ_RE = /^arn:aws:(sqs|sns):[a-z0-9-]+:\d{12}:[A-Za-z0-9-_]+$/;
const SNS_RE = /^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9-_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasWildcard(value: string): boolean {
  return value.includes("*");
}

export function validateAwsStagingContract(input: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["contract"] };
  const c = input as Record<string, unknown>;

  const requireString = (field: string, re?: RegExp, noWildcard = true) => {
    const v = c[field];
    if (!nonEmpty(v)) {
      errors.push(field);
      return;
    }
    if (noWildcard && hasWildcard(v)) {
      errors.push(field);
      return;
    }
    if (re && !re.test(v.trim())) errors.push(field);
  };

  // Account / region — never echo values, only field names.
  if (typeof c.awsAccountId !== "string" || !ACCOUNT_RE.test(c.awsAccountId)) {
    errors.push("awsAccountId");
  }
  if (
    typeof c.awsProductionAccountId !== "string" ||
    !ACCOUNT_RE.test(c.awsProductionAccountId)
  ) {
    errors.push("awsProductionAccountId");
  }
  if (
    typeof c.awsAccountId === "string" &&
    typeof c.awsProductionAccountId === "string" &&
    c.awsAccountId === c.awsProductionAccountId
  ) {
    errors.push("productionAccountMisuse");
  }
  requireString("awsRegion", REGION_RE);
  requireString("ecrRepository", ECR_RE);
  requireString("ecsCluster");
  requireString("webServiceName");
  requireString("webTaskFamily");
  requireString("reconciliationTaskFamily");

  // Networking — runner must stay private.
  const subnets = c.privateSubnetIds;
  if (
    !Array.isArray(subnets) ||
    subnets.length < 2 ||
    !subnets.every(
      (s): s is string => typeof s === "string" && SUBNET_RE.test(s),
    )
  ) {
    errors.push("privateSubnetIds");
  }
  requireString("webSecurityGroupId", SG_RE, false);
  requireString("runnerSecurityGroupId", SG_RE, false);
  if (c.runnerUsesPublicSubnet !== false) errors.push("runnerUsesPublicSubnet");

  requireString("loadBalancerListenerArn", ELB_LISTENER_RE);
  requireString("loadBalancerTargetGroupArn", ELB_TG_RE);

  // HTTPS origin must be exactly the origin, https only.
  const origin = c.stagingHttpsOrigin;
  if (typeof origin !== "string" || origin.length === 0) {
    errors.push("stagingHttpsOrigin");
  } else {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || origin !== url.origin) {
        errors.push("stagingHttpsOrigin");
      }
    } catch {
      errors.push("stagingHttpsOrigin");
    }
  }

  requireString("route53AcmDecision");

  // IAM — no wildcard, strict ARN shape.
  requireString("webRoleArn", IAM_ROLE_RE);
  requireString("runnerRoleArn", IAM_ROLE_RE);
  requireString("schedulerRoleArn", IAM_ROLE_RE);
  requireString("deployRoleArn", IAM_ROLE_RE);

  const oidc = c.githubOidcSubject;
  if (
    typeof oidc !== "string" ||
    !oidc.startsWith("repo:") ||
    !oidc.includes("/") ||
    hasWildcard(oidc)
  ) {
    errors.push("githubOidcSubject");
  }

  const secrets = c.secretsManagerArns;
  if (
    !Array.isArray(secrets) ||
    secrets.length < 1 ||
    !secrets.every(
      (s): s is string => typeof s === "string" && SECRETS_RE.test(s),
    )
  ) {
    errors.push("secretsManagerArns");
  }
  requireString("kmsKeyArn", KMS_RE);

  const logs = c.cloudWatchLogGroups;
  if (
    !Array.isArray(logs) ||
    logs.length < 1 ||
    !logs.every(
      (s): s is string =>
        typeof s === "string" && s.startsWith("/aws/") && !hasWildcard(s),
    )
  ) {
    errors.push("cloudWatchLogGroups");
  }
  const retention = c.logRetentionDays;
  if (
    typeof retention !== "number" ||
    !Number.isSafeInteger(retention) ||
    retention < 1 ||
    retention > 3653
  ) {
    errors.push("logRetentionDays");
  }

  requireString("eventBridgeScheduleName");
  requireString("eventBridgeTimeZone");
  requireString("eventBridgeCadence");
  requireString("schedulerDlqArn", DLQ_RE);
  requireString("alarmDestinationArn", SNS_RE);

  const slack = c.slackComplianceDestination;
  if (
    typeof slack !== "string" ||
    slack.trim().length === 0 ||
    slack.trim().toLowerCase().startsWith("http")
  ) {
    errors.push("slackComplianceDestination");
  }

  if (typeof c.budgetOwner !== "string" || !EMAIL_RE.test(c.budgetOwner)) {
    errors.push("budgetOwner");
  }
  if (
    typeof c.budgetThresholdGbp !== "number" ||
    !Number.isFinite(c.budgetThresholdGbp) ||
    c.budgetThresholdGbp <= 0
  ) {
    errors.push("budgetThresholdGbp");
  }
  if (c.supabaseEgressApproved !== true) errors.push("supabaseEgressApproved");
  if (typeof c.rollbackOwner !== "string" || !EMAIL_RE.test(c.rollbackOwner)) {
    errors.push("rollbackOwner");
  }

  const iac = c.allowedIacCiPath;
  if (
    typeof iac !== "string" ||
    iac.trim().length === 0 ||
    !(
      iac === "in-repo:.github/workflows/deploy-aws-staging.yml" ||
      iac.startsWith("external:")
    )
  ) {
    errors.push("allowedIacCiPath");
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function readContractFromEnv(
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const numberOrUndefined = (v: string | undefined) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  };
  return {
    awsAccountId: env.AWS_STAGING_ACCOUNT_ID,
    awsProductionAccountId: env.AWS_PRODUCTION_ACCOUNT_ID,
    awsRegion: env.AWS_STAGING_REGION,
    ecrRepository: env.AWS_STAGING_ECR_REPOSITORY,
    ecsCluster: env.AWS_STAGING_ECS_CLUSTER,
    webServiceName: env.AWS_STAGING_WEB_SERVICE,
    webTaskFamily: env.AWS_STAGING_WEB_TASK_FAMILY,
    reconciliationTaskFamily: env.AWS_STAGING_RECONCILIATION_TASK_FAMILY,
    privateSubnetIds: parseList(env.AWS_STAGING_PRIVATE_SUBNET_IDS),
    webSecurityGroupId: env.AWS_STAGING_WEB_SG,
    runnerSecurityGroupId: env.AWS_STAGING_RUNNER_SG,
    runnerUsesPublicSubnet: env.AWS_STAGING_RUNNER_USES_PUBLIC_SUBNET
      ? env.AWS_STAGING_RUNNER_USES_PUBLIC_SUBNET !== "false" &&
        env.AWS_STAGING_RUNNER_USES_PUBLIC_SUBNET !== "0"
      : undefined,
    loadBalancerListenerArn: env.AWS_STAGING_ALB_LISTENER_ARN,
    loadBalancerTargetGroupArn: env.AWS_STAGING_ALB_TARGET_GROUP_ARN,
    stagingHttpsOrigin: env.AWS_STAGING_HTTPS_ORIGIN,
    route53AcmDecision: env.AWS_STAGING_ROUTE53_ACM_DECISION,
    webRoleArn: env.AWS_STAGING_WEB_ROLE_ARN,
    runnerRoleArn: env.AWS_STAGING_RUNNER_ROLE_ARN,
    schedulerRoleArn: env.AWS_STAGING_SCHEDULER_ROLE_ARN,
    deployRoleArn: env.AWS_STAGING_DEPLOY_ROLE_ARN,
    githubOidcSubject: env.AWS_STAGING_OIDC_SUBJECT,
    secretsManagerArns: parseList(env.AWS_STAGING_SECRETS_ARNS),
    kmsKeyArn: env.AWS_STAGING_KMS_KEY_ARN,
    cloudWatchLogGroups: parseList(env.AWS_STAGING_LOG_GROUPS),
    logRetentionDays: numberOrUndefined(env.AWS_STAGING_LOG_RETENTION_DAYS),
    eventBridgeScheduleName: env.AWS_STAGING_SCHEDULE_NAME,
    eventBridgeTimeZone: env.AWS_STAGING_SCHEDULE_TIMEZONE,
    eventBridgeCadence: env.AWS_STAGING_SCHEDULE_CADENCE,
    schedulerDlqArn: env.AWS_STAGING_SCHEDULER_DLQ_ARN,
    alarmDestinationArn: env.AWS_STAGING_ALARM_DESTINATION_ARN,
    slackComplianceDestination: env.AWS_STAGING_SLACK_DESTINATION,
    budgetOwner: env.AWS_STAGING_BUDGET_OWNER,
    budgetThresholdGbp: numberOrUndefined(
      env.AWS_STAGING_BUDGET_THRESHOLD_GBP,
    ),
    supabaseEgressApproved:
      env.AWS_STAGING_SUPABASE_EGRESS_APPROVED === "1" ||
      env.AWS_STAGING_SUPABASE_EGRESS_APPROVED === "true"
        ? true
        : env.AWS_STAGING_SUPABASE_EGRESS_APPROVED === undefined
          ? undefined
          : false,
    rollbackOwner: env.AWS_STAGING_ROLLBACK_OWNER,
    allowedIacCiPath: env.AWS_STAGING_IAC_PATH,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = validateAwsStagingContract(readContractFromEnv(process.env));
  // Intentionally print only field names, never supplied values.
  if (result.ok) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, errors: [] })}\n`,
    );
  } else {
    process.stderr.write(
      `${JSON.stringify({ ok: false, errors: result.errors })}\n`,
    );
    process.exitCode = 1;
  }
}
