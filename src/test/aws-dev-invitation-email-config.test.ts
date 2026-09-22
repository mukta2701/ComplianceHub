import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy-aws-dev.yml", "utf8");

describe("AWS dev invitation email configuration", () => {
  it("passes both invitation email settings to App Runner", () => {
    expect(workflow).toContain("RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}");
    expect(workflow).toContain("INVITATION_FROM_EMAIL: ${{ vars.INVITATION_FROM_EMAIL }}");
    expect(workflow).toContain('--arg resendApiKey "$RESEND_API_KEY"');
    expect(workflow).toContain('--arg invitationFromEmail "$INVITATION_FROM_EMAIL"');
    expect(workflow).toContain("RESEND_API_KEY: $resendApiKey");
    expect(workflow).toContain("INVITATION_FROM_EMAIL: $invitationFromEmail");
  });
});
