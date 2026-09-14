"use strict";

// CommonJS is required because the proof server loads this guard through Node's --require preload hook.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chmodSync, readFileSync, statSync, writeFileSync } = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require("node:path");

const ledgerPath = process.env.MCP_PROOF_SERVER_NETWORK_LEDGER;
const runId = process.env.MCP_PROOF_SERVER_RUN_ID;
if (!ledgerPath || !runId || !/^[A-Za-z0-9_-]{43}$/.test(runId)) {
  throw new Error("The MCP proof server network identity is required.");
}

function readLedger() {
  let value;
  try {
    if ((statSync(ledgerPath).mode & 0o777) !== 0o600) throw new Error("unsafe mode");
    value = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch {
    throw new Error("The MCP proof server network ledger is invalid.");
  }
  if (value?.schemaVersion !== 1
    || value.runId !== runId
    || value.guardActive !== true
    || Object.keys(value).sort().join(",") !== "guardActive,runId,schemaVersion") {
    throw new Error("The MCP proof server network ledger is invalid.");
  }
}

const eventDirectory = `${ledgerPath}.events`;
try {
  if (!statSync(eventDirectory).isDirectory() || (statSync(eventDirectory).mode & 0o777) !== 0o700) {
    throw new Error("unsafe event directory");
  }
} catch {
  throw new Error("The MCP proof server event directory is invalid.");
}

function appendEvent(event, label) {
  const eventPath = join(eventDirectory, `${label}-${process.pid}-${randomUUID()}.json`);
  writeFileSync(eventPath, `${JSON.stringify({ schemaVersion: 1, runId, ...event })}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(eventPath, 0o600);
}

function providerKind(hostname) {
  const host = hostname.toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "slack.com" || host.endsWith(".slack.com") || host === "slack-gov.com" || host.endsWith(".slack-gov.com")) return "slack";
  return null;
}

readLedger();
appendEvent({ kind: "activation", pid: process.pid, parentPid: process.ppid }, "activation");

const originalFetch = globalThis.fetch;
if (typeof originalFetch !== "function") throw new Error("The MCP proof server requires global fetch.");

globalThis.fetch = async function guardedMcpProofFetch(input, init) {
  const rawUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
  const kind = providerKind(new URL(rawUrl).hostname);
  if (kind) {
    appendEvent({ kind: "provider-attempt", provider: kind, pid: process.pid }, `provider-${kind}`);
    throw new Error("External provider network access is blocked during the MCP proof.");
  }
  return originalFetch(input, init);
};
