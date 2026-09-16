// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildValidStagingContract,
  validateAwsStagingContract,
} from "./validate-aws-staging-contract";

describe("validate-aws-staging-contract", () => {
  it("accepts a complete safe staging contract", () => {
    const result = validateAwsStagingContract(buildValidStagingContract());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails for each missing required field", () => {
    const base = buildValidStagingContract() as Record<string, unknown>;
    const required = [
      "awsAccountId",
      "awsRegion",
      "ecrRepository",
      "ecsCluster",
      "webServiceName",
      "webTaskFamily",
      "reconciliationTaskFamily",
      "privateSubnetIds",
      "webSecurityGroupId",
      "runnerSecurityGroupId",
      "loadBalancerListenerArn",
      "loadBalancerTargetGroupArn",
      "stagingHttpsOrigin",
      "route53AcmDecision",
      "webRoleArn",
      "runnerRoleArn",
      "schedulerRoleArn",
      "deployRoleArn",
      "githubOidcSubject",
      "secretsManagerArns",
      "kmsKeyArn",
      "cloudWatchLogGroups",
      "logRetentionDays",
      "eventBridgeScheduleName",
      "eventBridgeTimeZone",
      "eventBridgeCadence",
      "schedulerDlqArn",
      "alarmDestinationArn",
      "slackComplianceDestination",
      "budgetOwner",
      "budgetThresholdGbp",
      "rollbackOwner",
      "allowedIacCiPath",
    ];
    for (const field of required) {
      const candidate = { ...base };
      delete candidate[field];
      const result = validateAwsStagingContract(candidate);
      expect(result.ok, `expected failure when ${field} missing`).toBe(false);
      expect(result.errors.join(",")).toContain(field);
    }
  });

  it("rejects production account misuse", () => {
    const base = buildValidStagingContract();
    const result = validateAwsStagingContract({
      ...base,
      awsAccountId: base.awsProductionAccountId,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(",")).toMatch(/production|account/i);
  });

  it("rejects a non-HTTPS staging origin", () => {
    const result = validateAwsStagingContract({
      ...buildValidStagingContract(),
      stagingHttpsOrigin: "http://staging.example.com",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(",")).toContain("stagingHttpsOrigin");
  });

  it("rejects a runner placed in a public subnet", () => {
    const result = validateAwsStagingContract({
      ...buildValidStagingContract(),
      runnerUsesPublicSubnet: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(",")).toContain("runnerUsesPublicSubnet");
  });

  it("rejects wildcard role ARNs", () => {
    const base = buildValidStagingContract();
    const result = validateAwsStagingContract({
      ...base,
      webRoleArn: "arn:aws:iam::123456789012:role/*",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(",")).toContain("webRoleArn");
  });

  it("rejects zero and indefinite log retention", () => {
    for (const days of [0, 99999]) {
      const result = validateAwsStagingContract({
        ...buildValidStagingContract(),
        logRetentionDays: days,
      });
      expect(result.ok, `expected failure for retention ${days}`).toBe(false);
      expect(result.errors.join(",")).toContain("logRetentionDays");
    }
  });

  it("rejects missing budget and alarm ownership", () => {
    const missingBudget = validateAwsStagingContract({
      ...buildValidStagingContract(),
      budgetOwner: "",
    });
    expect(missingBudget.ok).toBe(false);
    expect(missingBudget.errors.join(",")).toContain("budgetOwner");

    const missingAlarm = validateAwsStagingContract({
      ...buildValidStagingContract(),
      alarmDestinationArn: "",
    });
    expect(missingAlarm.ok).toBe(false);
    expect(missingAlarm.errors.join(",")).toContain("alarmDestinationArn");
  });

  it("never echoes secret-bearing values in errors", () => {
    const sentinel = "sentinel-secret-value-xyz-123";
    const result = validateAwsStagingContract({
      ...buildValidStagingContract(),
      webRoleArn: sentinel,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.errors)).not.toContain(sentinel);
  });
});
