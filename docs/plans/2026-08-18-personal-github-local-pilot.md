# Personal GitHub Local Pilot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permit an explicitly configured personal GitHub account only in a non-production loopback ComplianceHub runtime while preserving organisation-only defaults everywhere else.

**Architecture:** Add a pure fail-closed account-policy resolver, pass its result from the OAuth callback into the existing installation claim boundary, and persist the already verified provider account type. The database schema already accepts `Organization` and `User`, so the change is limited to TypeScript policy, claim, route wiring, and tests.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Zod, Vitest, Supabase RPCs, GitHub App OAuth.

## Current implementation status — 2026-08-18

- [x] Tasks 1–3 are implemented and covered by the account-policy, installation
  claim, and callback contract tests.
- [x] Local shadow evidence is executable: the selected
  `mukta2701/ComplianceHub` repository is read-only, the collection summary is
  rendered as current/partial, and readiness remains unchanged. The exact
  branch CI run also passes the production desktop/mobile suite.
- [ ] Task 4 live acceptance remains open until the GitHub App is approved and
  installed for the owner-controlled account/repository. A GitHub user token
  returning `403` from the installations API is not installation proof.

---

### Task 1: Fail-closed GitHub account-type policy

**Files:**
- Create: `src/features/github/application/github-account-policy.test.ts`
- Create: `src/features/github/application/github-account-policy.ts`

**Step 1: Write the failing policy tests**

Cover these exact cases:

```ts
expect(resolveGitHubAccountType({})).toBe("Organization");
expect(resolveGitHubAccountType({ configuredType: "Organization", nodeEnv: "production", siteUrl: "https://app.example" })).toBe("Organization");
expect(resolveGitHubAccountType({ configuredType: "User", nodeEnv: "development", siteUrl: "http://127.0.0.1:3000" })).toBe("User");
expect(resolveGitHubAccountType({ configuredType: "User", nodeEnv: "test", siteUrl: "http://localhost:3000" })).toBe("User");
```

Reject `User` for production, HTTPS or non-loopback sites, missing/malformed sites, credentials/query/hash in the URL, and reject every unknown configured type.

**Step 2: Run the policy test to verify RED**

Run: `npx vitest run src/features/github/application/github-account-policy.test.ts`

Expected: FAIL because `github-account-policy` does not exist.

**Step 3: Implement the minimal resolver**

Create a pure resolver exporting:

```ts
export type GitHubAccountType = "Organization" | "User";

export function resolveGitHubAccountType(input: {
  configuredType?: string;
  nodeEnv?: string;
  siteUrl?: string;
}): GitHubAccountType
```

Default only `undefined` or empty configuration to `Organization`. Return `Organization` explicitly without weakening hosted behavior. Return `User` only when `nodeEnv !== "production"` and `siteUrl` parses as credential-free, query-free, hash-free HTTP with hostname exactly `localhost` or `127.0.0.1`. Throw the fixed error `GitHub account type configuration is invalid` for every other case.

**Step 4: Run the policy tests to verify GREEN**

Run: `npx vitest run src/features/github/application/github-account-policy.test.ts`

Expected: all policy cases PASS.

**Step 5: Commit the policy boundary**

```bash
git add src/features/github/application/github-account-policy.ts src/features/github/application/github-account-policy.test.ts
git commit -m "feat(github): gate personal accounts to local pilots"
```

### Task 2: Accept the verified configured account type in claims

**Files:**
- Modify: `src/features/github/application/installation-claim.test.ts`
- Modify: `src/features/github/application/installation-claim.ts:32-42,117-146`

**Step 1: Write the failing claim test**

Create a personal claim by changing the verified fixture account to `{ id: 61040544, login: "mukta2701", type: "User" }` and its repository owner/full name accordingly. Call:

```ts
await claimInstallation(personal, {
  allowedAccountId: 61040544,
  allowedAccountType: "User",
  persist,
});
```

Assert persistence receives `accountType: "User"`. Keep the existing personal-account rejection case unchanged to prove default organisation mode still rejects it. Add a mismatched configured-type rejection assertion.

**Step 2: Run the claim test to verify RED**

Run: `npx vitest run src/features/github/application/installation-claim.test.ts`

Expected: FAIL because the claim ignores `allowedAccountType` and rejects the personal fixture.

**Step 3: Implement the minimal claim change**

Import `GitHubAccountType`. Change `CanonicalInstallationClaim.accountType` to that union, add `allowedAccountType?: GitHubAccountType` to dependencies, default it to `Organization`, compare `app.account.type` with that value, and persist the verified configured type. Do not alter account-ID, repository-selection, permissions, suspension, user-visibility, repository canonicalisation, or persistence-error checks.

**Step 4: Run claim and policy tests to verify GREEN**

Run: `npx vitest run src/features/github/application/github-account-policy.test.ts src/features/github/application/installation-claim.test.ts`

Expected: all tests PASS.

**Step 5: Commit claim support**

```bash
git add src/features/github/application/installation-claim.ts src/features/github/application/installation-claim.test.ts
git commit -m "feat(github): claim verified local personal installations"
```

### Task 3: Resolve policy before callback mutations

**Files:**
- Modify: `src/app/api/github/callback/route.test.ts`
- Modify: `src/app/api/github/callback/route.ts:122-162`

**Step 1: Write failing callback tests**

Add `GITHUB_ALLOWED_ACCOUNT_TYPE` cleanup/default handling. Prove a loopback non-production `User` configuration calls:

```ts
expect(hoisted.claim).toHaveBeenCalledWith(
  expect.objectContaining({ appInstallation: expect.objectContaining({ account: expect.objectContaining({ type: "User" }) }) }),
  { allowedAccountType: "User" },
);
```

Use a table to prove production personal mode, hosted personal mode, malformed site URL, and unknown account type redirect to `?github=configuration_error` before consuming OAuth state or exchanging a token.

**Step 2: Run the callback test to verify RED**

Run: `npx vitest run src/app/api/github/callback/route.test.ts`

Expected: FAIL because the callback neither validates nor forwards account type.

**Step 3: Wire the resolver into the callback**

Resolve the account type beside the existing App ID/private key/account ID validation. Map resolver failures to the existing `configuration_error` redirect before `consume_github_oauth_state_server`. Pass `{ allowedAccountType }` as the second argument to `claimInstallation`.

**Step 4: Run focused tests to verify GREEN**

Run: `npx vitest run src/features/github/application/github-account-policy.test.ts src/features/github/application/installation-claim.test.ts src/app/api/github/callback/route.test.ts`

Expected: all focused tests PASS.

**Step 5: Commit route wiring**

```bash
git add src/app/api/github/callback/route.ts src/app/api/github/callback/route.test.ts
git commit -m "feat(github): wire local personal account policy"
```

### Task 4: Verification and live acceptance

**Files:**
- No repository file changes expected.

**Step 1: Run static and regression checks**

Run:

```bash
npm run typecheck
npx eslint src/features/github/application/github-account-policy.ts src/features/github/application/github-account-policy.test.ts src/features/github/application/installation-claim.ts src/features/github/application/installation-claim.test.ts src/app/api/github/callback/route.ts src/app/api/github/callback/route.test.ts
npm test -- --run src/features/github/application/github-account-policy.test.ts src/features/github/application/installation-claim.test.ts src/app/api/github/callback/route.test.ts
git diff --check
```

Expected: every command exits zero.

**Step 2: Restart the local server with temporary pilot configuration**

Use the existing secure temporary runtime mechanism and add `GITHUB_ALLOWED_ACCOUNT_TYPE=User`. Keep credentials out of files, command output, and logs.

**Step 3: Repeat the real OAuth claim**

Open `/api/github/setup?installation_id=154509880&setup_action=update`, authorize `mukta2701`, and expect `/app/integrations?github=connected`. Confirm only `mukta2701/ComplianceHub` is available and selected.

**Step 4: Run the real read-only shadow collection**

Record the dashboard readiness percentage, run collection for the selected personal repository, and wait for a terminal collection status. Confirm the repository summary is rendered and readiness is unchanged.

**Step 5: Inspect runtime evidence**

Confirm no provider credentials are logged, no evidence/findings/readiness rows were mutated by the shadow run, and the repository working tree is clean.

**Step 6: Commit any verification-only documentation if created**

No commit is required when verification creates no tracked files.
