import { runGitHubShadowProofCli } from "../src/features/github/application/github-shadow-proof-cli";

void runGitHubShadowProofCli().then((exitCode) => {
  process.exitCode = exitCode;
});
