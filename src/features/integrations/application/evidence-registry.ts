import "server-only";
import type { EvidenceProvider, EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { fakeEvidenceProvider } from "@/features/integrations/domain/evidence-provider";
import { githubEvidenceProvider } from "./github-evidence";
import { googleWorkspaceEvidenceProvider } from "./google-workspace-evidence";

// The fake collector is the default (dev + tests). Live collection from Google
// Workspace / GitHub / AWS is opt-in via EVIDENCE_LIVE=1 and requires the user's
// OAuth-app tokens on the source (documented go-live step). Real network adapters
// are explicitly configured. AWS uses SigV4 rather than a bearer token, so this
// adapter fails closed until a dedicated signed-credential integration exists.
const unavailableAwsProvider: EvidenceProvider = { collect: async () => { throw new Error("AWS live evidence collection requires a SigV4 credential adapter"); } };
const LIVE_PROVIDERS: Record<EvidenceProviderKind, EvidenceProvider> = {
  google_workspace: googleWorkspaceEvidenceProvider,
  github: githubEvidenceProvider,
  aws: unavailableAwsProvider,
};

export function resolveEvidenceProvider(provider: EvidenceProviderKind): EvidenceProvider {
  if (process.env.EVIDENCE_LIVE === "1") return LIVE_PROVIDERS[provider];
  return fakeEvidenceProvider;
}
