# ComplianceHub Internal MCP and Daily Slack Digest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an OAuth-protected hosted MCP read interface and one verified,
Owner-only daily Slack digest workflow to ComplianceHub.

**Architecture:** The existing Next.js deployment exposes Streamable HTTP MCP
tools backed by a user-scoped Supabase client. Codex supplies language reasoning;
ComplianceHub supplies validated facts, permissions, hashing, Slack delivery,
and audit history.

**Tech Stack:** Next.js 16, TypeScript 5, Zod 4, Supabase Auth/Postgres/RLS,
Model Context Protocol TypeScript SDK, Vitest, pgTAP, Slack incoming webhooks.

---

## Tasks

1. Add the digest database contract: one configured Slack digest channel,
   delivery ledger, explicit grants, Owner-only RLS, audit trigger, uniqueness,
   and pgTAP attack/race tests.
2. Build pure digest facts, deterministic hashing, message validation, and Slack
   payload construction test-first.
3. Add protected-resource metadata, OAuth consent, JWT verification, user-scoped
   Supabase request context, and structured MCP errors.
4. Add workspace resolution and read services for overview, attention items,
   findings, leadership report, and digest facts.
5. Register the seven focused MCP tools over Streamable HTTP with accurate
   schemas, structured results, annotations, and OAuth challenges.
6. Implement Owner-only reservation, fact revalidation, encrypted webhook
   delivery, terminal delivery states, safe retry rules, and audit logging.
7. Package a private ComplianceHub plugin and daily-compliance-brief skill, then
   validate the plugin structure.
8. Run unit, database, integration, MCP Inspector, build, and full verification;
   document the staging OAuth, Slack shadow-run, schedule, and dogfood checklist.

## Acceptance

- Codex and Claude can authenticate to the same staging endpoint and can only
  read organisations available to the signed-in user.
- Every numeric digest claim originates in the prepared facts and a stale hash
  cannot be posted.
- Only an Owner can post; Admin, Member, anonymous, and cross-tenant callers fail.
- Concurrent calls cannot produce duplicate daily posts, and unknown delivery
  outcomes are never retried automatically.
- Existing web, monitoring, Slack alerts, and verification suites remain green.
