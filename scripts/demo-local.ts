import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type LauncherCommand = "build" | "start" | "test-e2e" | "setup";
export type LocalStatus = {
  API_URL?: string;
  ANON_KEY?: string;
  SERVICE_ROLE_KEY?: string;
  PROJECT_ID?: string;
  [key: string]: unknown;
};
export type DemoBuildRecord = {
  sha: string;
  sourceState: string;
  apiUrl: string;
  migration: string;
  projectId: "compliancehub";
};

export function hashSourceFiles(files: Array<[string, string | Uint8Array]>): string {
  const hash = createHash("sha256");
  for (const [name, content] of files.sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update("\0").update(content).update("\0");
  return hash.digest("hex");
}

export function parseMigrationVersion(output: string): string {
  const version = output.trim();
  if (!/^[0-9]{8,14}$/.test(version)) throw failure("could not determine latest local migration");
  return version;
}

const root = resolve(process.cwd());
const recordPath = resolve(root, ".next/local-demo-build.json");
const origin = "http://127.0.0.1:3100";
const externalSecrets = [
  "AI_API_BASE_URL", "AI_API_KEY", "AI_MODEL", "EVIDENCE_LIVE", "INTEGRATIONS_LIVE",
  "GOOGLE_AUTH_ENABLED", "MICROSOFT_AUTH_ENABLED", "INVITATION_FROM_EMAIL", "JIRA_CLIENT_ID",
  "JIRA_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_SLUG", "GITHUB_WEBHOOK_SECRET", "GITHUB_ALLOWED_ACCOUNT_ID",
  "GITHUB_ALLOWED_ACCOUNT_TYPE", "GITHUB_APPROVED_SECURITY_WORKFLOW_IDS", "NANGO_BASE_URL",
  "NANGO_SECRET_KEY", "NANGO_GITHUB_INTEGRATION_ID", "NANGO_JIRA_INTEGRATION_ID",
  "SLACK_ALLOWED_WEBHOOK_SHA256", "RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM", "OPENAI_API_KEY", "OPENAI_BASE_URL",
  "SUPABASE_OAUTH_ISSUER", "SUPABASE_OAUTH_JWKS_URL",
] as const;

const failure = (message: string): Error => new Error(`demo-local: ${message}`);

export function parseLauncherArgs(args: string[]): { command: LauncherCommand; args: string[] } {
  const command = args[0] as LauncherCommand | undefined;
  if (!command || !["build", "start", "test-e2e", "setup"].includes(command)) throw failure("Unsupported command");
  const rest = args.slice(1);
  if (rest.length && rest[0] !== "--") throw failure("Arguments must follow --");
  return { command, args: rest.slice(1) };
}

export function validateLocalStatus(status: LocalStatus): void {
  if (status.API_URL !== "http://127.0.0.1:54321") throw failure("Supabase status does not report the exact local Supabase API URL");
  if (status.PROJECT_ID !== undefined && status.PROJECT_ID !== "compliancehub") throw failure("Supabase project must be compliancehub");
  if (typeof status.ANON_KEY !== "string" || !status.ANON_KEY || typeof status.SERVICE_ROLE_KEY !== "string" || !status.SERVICE_ROLE_KEY) {
    throw failure("Supabase status did not provide local keys");
  }
}

export function buildLocalEnvironment(base: NodeJS.ProcessEnv, status: LocalStatus, sha: string): NodeJS.ProcessEnv {
  validateLocalStatus(status);
  const env: NodeJS.ProcessEnv = { ...base };
  env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY as string;
  env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY as string;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY as string ?? "";
  env.SUPABASE_OAUTH_ISSUER = "";
  env.SUPABASE_OAUTH_JWKS_URL = "";
  env.NEXT_PUBLIC_SITE_URL = origin;
  env.NEXT_PUBLIC_APP_URL = origin;
  env.MCP_RESOURCE_URL = `${origin}/mcp`;
  env.COMPLIANCEHUB_RELEASE_SHA = sha;
  env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 67).toString("base64");
  env.CRON_SECRET = "compliancehub-local-demo-cron-secret";
  env.INTEGRATIONS_LIVE = "";
  env.EVIDENCE_LIVE = "";
  env.E2E_TEST_TOOLS_ENABLED = "1";
  for (const name of externalSecrets) env[name] = "";
  return env;
}

export function validateBuildRecord(expected: DemoBuildRecord, actual: DemoBuildRecord): void {
  if (expected.sha !== actual.sha || expected.sourceState !== actual.sourceState) throw failure("build source identity does not match the checked-out source");
  if (expected.apiUrl !== actual.apiUrl || expected.projectId !== actual.projectId) throw failure("build database identity does not match the local database");
  if (expected.migration !== actual.migration) throw failure("build migration does not match the local database");
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  try { return execFileSync(command, args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw failure(`command failed: ${command}`); }
}

function runInteractive(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

function localStatus(): LocalStatus {
  const raw = run("supabase", ["status", "-o", "json"]);
  let status: LocalStatus;
  try { status = JSON.parse(raw) as LocalStatus; } catch { throw failure("Supabase status was not valid JSON"); }
  const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
  if (!/^project_id\s*=\s*"compliancehub"\s*$/m.test(config)) throw failure("Supabase project config is not compliancehub");
  status.PROJECT_ID = "compliancehub";
  validateLocalStatus(status);
  return status;
}

function latestMigration(): string {
  return parseMigrationVersion(run("docker", ["exec", "supabase_db_compliancehub", "psql", "-U", "postgres", "-d", "postgres", "-Atc", "select max(version) from supabase_migrations.schema_migrations;"]));
}

function sourceState(): string {
  const files = run("git", ["ls-files", "-co", "--exclude-standard"])
    .split("\n")
    .filter((name) => /^(src|scripts|supabase|e2e)\//.test(name) || /^(package(-lock)?\.json|next\.config|eslint\.config|tsconfig|playwright\.config)/.test(name))
    .filter((name) => !/\.(png|jpe?g|gif|txt)$/.test(name));
  return hashSourceFiles(files.map((name) => [name, readFileSync(resolve(root, name))]));
}

function identity(status: LocalStatus): DemoBuildRecord {
  return { sha: run("git", ["rev-parse", "HEAD"]).trim(), sourceState: sourceState(), apiUrl: status.API_URL as string, migration: latestMigration(), projectId: "compliancehub" };
}

function dockerGuard(): void {
  try {
    if (process.env.DOCKER_HOST) throw failure("remote Docker override is not permitted");
    const context = run("docker", ["context", "show"]).trim();
    const endpoint = run("docker", ["context", "inspect", context, "--format", "{{(index .Endpoints \"docker\").Host}}"]).trim();
    const labels = run("docker", ["inspect", "--format", "{{index .Config.Labels \"com.supabase.cli.project\"}}|{{index .Config.Labels \"com.docker.compose.project\"}}", "supabase_db_compliancehub"]).trim();
    if (context !== "colima" || !/^unix:\/\/\/.*\/\.colima\/default\/docker\.sock$/.test(endpoint) || labels !== "compliancehub|compliancehub") throw failure("Docker identity is not the local compliancehub stack");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("demo-local:")) throw error;
    throw failure("could not verify local Docker identity");
  }
}

async function main(): Promise<void> {
  const parsed = parseLauncherArgs(process.argv.slice(2));
  const status = localStatus();
  dockerGuard();
  const sha = run("git", ["rev-parse", "HEAD"]).trim();
  const env = buildLocalEnvironment(process.env, status, sha);
  if (parsed.command === "setup") {
    const code = await runInteractive("node", ["--conditions=react-server", "--import=tsx", "scripts/showcase-setup.ts", ...parsed.args], env);
    if (code !== 0) process.exitCode = code;
    return;
  }
  if (parsed.command === "build") {
    const before = identity(status);
    const code = await runInteractive("npm", ["run", "build", ...parsed.args], env);
    if (code !== 0) { process.exitCode = code; return; }
    validateBuildRecord(before, identity(localStatus()));
    mkdirSync(resolve(root, ".next"), { recursive: true });
    writeFileSync(recordPath, `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 });
    chmodSync(recordPath, 0o600);
    return;
  }
  if (!existsSync(recordPath)) throw failure("no local build record; run build first");
  let record: DemoBuildRecord;
  try { record = JSON.parse(readFileSync(recordPath, "utf8")) as DemoBuildRecord; } catch { throw failure("local build record is invalid"); }
  validateBuildRecord(record, identity(status));
  if (parsed.command === "start") {
    const child: ChildProcess = spawn("bash", ["scripts/playwright-production-server.sh", "3100", ...parsed.args], { cwd: root, env, stdio: "inherit" });
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
    return;
  }
  env.CI = "1";
  env.PLAYWRIGHT_PORT = "3100";
  const child: ChildProcess = spawn("npm", ["run", "test:e2e", ...parsed.args], { cwd: root, env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "demo-local: failed"}\n`); process.exitCode = 1; });
}
