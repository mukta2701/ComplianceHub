"use strict";

// CommonJS is required because the proof server loads this guard through Node's --require preload hook.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chmodSync, readFileSync, renameSync, writeFileSync } = require("node:fs");

const ledgerPath = process.env.MCP_PROOF_SERVER_NETWORK_LEDGER;
if (!ledgerPath) throw new Error("The MCP proof server network ledger path is required.");

function readLedger() {
  try {
    const value = JSON.parse(readFileSync(ledgerPath, "utf8"));
    if (value?.guardActive !== true
      || !Number.isSafeInteger(value.githubAttempts) || value.githubAttempts < 0
      || !Number.isSafeInteger(value.slackAttempts) || value.slackAttempts < 0) {
      throw new Error("invalid ledger");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return { guardActive: true, githubAttempts: 0, slackAttempts: 0 };
    throw new Error("The MCP proof server network ledger is invalid.");
  }
}

function writeLedger(value) {
  const temporaryPath = `${ledgerPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, ledgerPath);
  chmodSync(ledgerPath, 0o600);
}

function providerKind(hostname) {
  const host = hostname.toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "slack.com" || host.endsWith(".slack.com") || host === "slack-gov.com" || host.endsWith(".slack-gov.com")) return "slack";
  return null;
}

writeLedger(readLedger());

const originalFetch = globalThis.fetch;
if (typeof originalFetch !== "function") throw new Error("The MCP proof server requires global fetch.");

globalThis.fetch = async function guardedMcpProofFetch(input, init) {
  const rawUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
  const kind = providerKind(new URL(rawUrl).hostname);
  if (kind) {
    const ledger = readLedger();
    if (kind === "github") ledger.githubAttempts += 1;
    else ledger.slackAttempts += 1;
    writeLedger(ledger);
    throw new Error("External provider network access is blocked during the MCP proof.");
  }
  return originalFetch(input, init);
};
