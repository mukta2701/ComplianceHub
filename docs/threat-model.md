# Threat model

Primary assets are tenant assessment evidence, SoA snapshots, risk records, membership, and audit history. Primary threats are cross-tenant access, privilege escalation, stale-write data loss, snapshot tampering, credential leakage, injection, and abusive public-demo traffic.

Controls include RLS attack tests, server-side validation and authorisation, optimistic revisions, immutable records, safe audit metadata, security headers, rate limiting at the deployment edge, and isolated demo data.
