# Canonical Port 3100 Implementation Plan

**Goal:** Make port `3100` the single active default for the ComplianceHub web app, MCP endpoint, local verification, CI, container, and Azure runtime without rewriting historical evidence or weakening negative security tests.

## Scope rules

- Change active runtime/configuration defaults and current operator documentation.
- Preserve historical plans/specifications/evidence that truthfully describe older work.
- Preserve `3000` values used deliberately as arbitrary or wrong-port security test inputs.
- Do not change product behavior beyond default port alignment.

## Task 1: Lock the contract with failing tests

- Add a focused contract test covering the active current files and expected `3100` defaults.
- Update existing fallback and local-preflight expectations from `3000` to `3100` where those values represent the current valid environment.
- Capture the RED result before implementation.

## Task 2: Align every active default

- Application start/dev scripts and site URL fallback.
- `.env.example`, README, and current deployment commands.
- Playwright and local runtime preflight defaults.
- CI site URL.
- Docker `PORT`/`EXPOSE` and Azure target port.
- Keep the canonical MCP endpoint at `http://127.0.0.1:3100/mcp`.

## Task 3: Verify and review

- Run focused port/runtime tests, local preflight, lint, typecheck, production build, and the full test suite.
- Start the ordinary app with the documented command and verify `/`, `/api/health`, and `/mcp` on `3100`; verify no app listens on `3000`.
- Independently review the diff for missed active defaults, accidental historical rewrites, and runtime/test regressions.
- Commit only scoped tracked changes; preserve user-owned untracked files.
