# Personal GitHub Local Pilot Design

## Purpose

Allow the local ComplianceHub development instance to verify the GitHub shadow-collection flow against the personal `mukta2701/ComplianceHub` repository. Hosted and production deployments must remain organisation-only by default.

## Security boundary

`GITHUB_ALLOWED_ACCOUNT_TYPE` is optional and defaults to `Organization`. Setting it to `User` is accepted only when all of these conditions hold:

- `NODE_ENV` is not `production`.
- `NEXT_PUBLIC_SITE_URL` is an HTTP loopback origin (`localhost` or `127.0.0.1`).
- The configured value is exactly `User`.

Unknown account types, a missing or malformed site URL for personal mode, non-loopback origins, and production personal mode fail closed as configuration errors. The existing exact account-ID, selected-repository, OAuth-user ownership, suspension, permission, repository-shape, and lease/persistence checks remain unchanged.

## Architecture and data flow

A small pure configuration resolver returns the permitted GitHub account type. The callback route resolves this value before calling the installation claim boundary. The claim boundary compares the verified GitHub installation account type with the resolved value and persists the verified type. It continues to default to `Organization` when called without an override.

The database already constrains `github_installations.account_type` to `Organization` or `User`, so no migration is required. The personal App credentials remain temporary process environment values and are not written to the repository or `.env.local`.

## Error handling

Configuration or verification failures continue to use the existing generic `configuration_error` or `verification_failed` redirects. Secrets, OAuth codes, provider responses, and internal failure details are not exposed to the browser or logs.

## Testing and acceptance

Tests will prove that:

- organisation mode remains the default;
- personal mode is accepted only for a non-production loopback site;
- production, hosted, malformed, and unknown personal-mode configurations fail closed;
- a verified personal installation is accepted only when its account ID and account type match the explicit local configuration;
- organisation claims and existing rejection cases remain green.

After unit, type, and lint checks, the live local acceptance run will reclaim installation `154509880`, select only `mukta2701/ComplianceHub`, run the real read-only collection, confirm repository summaries render, and confirm readiness remains unchanged.
