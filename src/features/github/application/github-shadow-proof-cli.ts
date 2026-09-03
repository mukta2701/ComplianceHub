import "server-only";

import { buildLocalGitHubShadowProofInput } from "./github-shadow-proof-local";
import { runGitHubShadowProof } from "./github-shadow-proof";

type CliDependencies = {
  environment: Record<string, string | undefined>;
  buildInput: typeof buildLocalGitHubShadowProofInput;
  runProof: typeof runGitHubShadowProof;
  stdout(value: string): void;
  stderr(value: string): void;
};

export async function runGitHubShadowProofCli(dependencies: Partial<CliDependencies> = {}): Promise<0 | 1> {
  const environment = dependencies.environment ?? process.env;
  const buildInput = dependencies.buildInput ?? buildLocalGitHubShadowProofInput;
  const runProof = dependencies.runProof ?? runGitHubShadowProof;
  const stdout = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  try {
    const result = await runProof(buildInput(environment));
    stdout(`${JSON.stringify({ proofPath: result.proofPath, summary: result.summary })}\n`);
    return 0;
  } catch {
    stderr("GitHub shadow proof failed\n");
    return 1;
  }
}
