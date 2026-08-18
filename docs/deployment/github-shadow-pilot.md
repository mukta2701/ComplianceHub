# GitHub shadow pilot evidence

This is the redacted operator worksheet for the personal/AdTecher GitHub shadow
pilot. It is intentionally not a completion certificate: shadow collection must
remain read-only and must not change readiness, evidence, findings, MCP answers,
or Slack output.

## Before the pilot

- [ ] Confirm the exact Azure origin and set
      `REGISTERED_GITHUB_APP_SITE_URL` to that origin.
- [ ] Confirm the dedicated GitHub App is approved and installed for the
      intended owner account and repository. Record only the repository name,
      installation ID, and reviewed permission/event set; never record keys.
- [ ] Verify the hosted Supabase backup and the complete pending migration set
      through `20260818070000` before setting the protected schema attestation.
- [ ] Confirm all eight server-only `AZURE_GITHUB_*` values are present in the
      protected environment, with the private key in escaped-newline PKCS#8
      form. Do not copy values into this document or build inputs.
- [ ] Capture a baseline for readiness percentage, evidence count, finding
      count, MCP fact responses, and Slack digest ledger rows for the pilot
      organisation.

## Controlled collection

1. Select exactly one repository in the GitHub setup flow and record the
   redacted installation/repository identifiers.
2. Run one manual collection for the reviewed revision. Confirm the run is
   `succeeded` or `partial`, observations are sanitised, and the collection
   summary identifies the same installation and repository.
3. Repeat the same collection once to prove idempotency. The second run may
   create a new run record, but it must not duplicate source observations or
   create a second webhook delivery for the same delivery ID.
4. Compare the post-run baseline. Readiness, evidence, findings, MCP answers,
   and Slack output must be unchanged. If any value changes unexpectedly, stop
   the pilot and preserve the run ID for investigation.
5. Exercise the webhook replay boundary with a redacted delivery fixture and
   confirm the duplicate delivery is rejected without a second collection.

## Redacted result

| Field | Result |
| --- | --- |
| Environment / SHA | `[owner fills]` |
| Organisation | `[redacted]` |
| Installation / repository | `[redacted]` |
| First run ID / status | `[owner fills]` |
| Repeat run ID / status | `[owner fills]` |
| Idempotency result | `[pass / fail]` |
| Readiness delta | `[0.00% expected]` |
| Evidence / findings / MCP / Slack delta | `[0 expected]` |
| Replay result | `[rejected / fail]` |
| Owner / date (Europe/London) | `[owner fills]` |

Do not deploy or mark the pilot accepted while any pre-pilot checkpoint is
unchecked, while the baseline comparison is missing, or while the dedicated
repository/App approval is only assumed from a user-token API response.
