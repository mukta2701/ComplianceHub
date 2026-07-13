# Auditor Access Log Design

## Scope

Record every successful resolution of a time-boxed auditor link and show an audit owner a small, safe recent-history list on the existing audit detail page. Preserve the public, login-free auditor view and its current invalid, expired, and revoked-token behaviour.

## Architecture and data flow

`public.auditor_access_log` is an append-only, organisation-scoped table containing an id, organisation id, auditor token id, and `viewed_at`. A composite foreign key keeps the referenced token in the same organisation and restricts parent-token deletion once history exists. RLS exposes `SELECT` only to owners of that organisation; explicit grants and the absence of insert/update/delete policies deny direct anonymous and authenticated writes. The table does not use the generic audit-event trigger because each row is already the canonical view event and duplicating it would expose noisy activity to ordinary members.

`public.audit_view_for_token(raw_token)` remains the only public token-resolution endpoint. Its existing security-definer body first resolves an unexpired, unrevoked token. Only after that check succeeds does it insert one row with the resolved token id and organisation id, then construct the unchanged response. Returning early for invalid tokens therefore produces no log entry.

The owner audit detail page loads at most ten recent log rows through an inner relationship filtered by the current audit id. Query failures abort the render rather than masquerading as an empty history. It renders only the token label and view timestamp; raw tokens, token hashes, user agents, IP addresses, and unrelated organisation data are never selected or displayed.

## Security and verification

The migration is idempotent, pins the function `search_path`, retains the deliberately narrow `anon`/`authenticated` execute grant for public token access, and gives no table write grant to either role. A matching pgTAP suite proves owner read access, same-organisation non-owner and cross-tenant denial, direct insert denial, exact-token logging on successful RPC resolution, and no logging for invalid/expired/revoked tokens. Focused tests, local migration via Docker `psql`, runtime mint/view/owner-read smoke, and `npm run verify` complete the gate.
