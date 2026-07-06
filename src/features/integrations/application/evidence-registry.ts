import type { EvidenceProvider, EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { fakeEvidenceProvider } from "@/features/integrations/domain/evidence-provider";

// The fake collector is the default (dev + tests). Live collection from Google
// Workspace / GitHub / AWS is opt-in via EVIDENCE_LIVE=1 and requires the user's
// OAuth-app tokens on the source (documented go-live step). Real network adapters
// are Stage 2 / deferred; the live registry below is a placeholder that still
// returns the fake per provider, so no live network reaches tests.
const LIVE_PROVIDERS: Record<EvidenceProviderKind, EvidenceProvider> = {
  // TODO(B3 Stage 2): replace each with the real network adapter.
  google_workspace: fakeEvidenceProvider,
  github: fakeEvidenceProvider,
  aws: fakeEvidenceProvider,
};

export function resolveEvidenceProvider(provider: EvidenceProviderKind): EvidenceProvider {
  if (process.env.EVIDENCE_LIVE === "1") return LIVE_PROVIDERS[provider];
  return fakeEvidenceProvider;
}
