# ComplianceHub Production Beta Implementation Plan

> **For Codex:** Use `superpowers:executing-plans` and implement tasks test-first.

## Goal

Deliver a UK-first, open-source readiness application that provides a guided assessment, dashboard, reviewable and reproducible Statement of Applicability exports, an auditable risk register, secure organisation tenancy, and a safe public demo.

## Milestones

1. Foundation: Next.js, quality gates, design system, Supabase tenancy, authentication, and RLS.
2. Assessment: versioned original catalogue, deterministic scoring, autosave, guided workflow, and dashboard.
3. SoA: reviewed drafts, immutable final snapshots, and matching PDF/DOCX exports.
4. Risks: explicit gap suggestions, treatments, residual scoring, register, and accessible heat map.
5. Beta: isolated demo, security/privacy hardening, responsive accessibility, CI, deployment and release documentation.

## Invariants

- Never expose the service-role key to browser code.
- Every tenant row is protected by RLS and cross-tenant attack tests.
- Catalogue versions, audit events, and final SoA snapshots are immutable.
- Stale assessment saves return a conflict instead of overwriting newer data.
- Assessment content is original and owner-reviewed; ComplianceHub does not certify organisations.
- All release gates must pass before the beta is declared complete.
