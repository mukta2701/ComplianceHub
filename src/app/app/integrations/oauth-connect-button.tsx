"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";
import {
  confirmProviderAuthorizationAction,
  startProviderAuthorizationAction,
} from "./actions";

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
};

export function OAuthConnectButton({ provider }: { provider: IntegrationProvider }) {
  const label = PROVIDER_LABEL[provider];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const session = await startProviderAuthorizationAction(provider);
      if (!session.configured) {
        setMessage(`Provider setup is required before ${label} can be connected.`);
        setBusy(false);
        return;
      }

      const { default: Nango } = await import("@nangohq/frontend");
      const nango = new Nango({ connectSessionToken: session.token });
      nango.openConnectUI({
        apiURL: session.apiBaseUrl,
        onEvent: async (event) => {
          if (event.type === "connect") {
            if (event.payload.isPending) {
              setMessage(`${label} connection is still pending. Nothing was saved yet.`);
              setBusy(false);
              return;
            }
            try {
              await confirmProviderAuthorizationAction({
                provider,
                connectionId: event.payload.connectionId,
                providerConfigKey: event.payload.providerConfigKey,
              });
              setMessage(`${label} connected. Choose what ComplianceHub may use below.`);
              router.refresh();
            } catch {
              setMessage(`Could not complete the ${label} connection. Nothing was saved.`);
            }
            setBusy(false);
          } else if (event.type === "error") {
            setMessage(`${label} did not connect. Please try again.`);
            setBusy(false);
          } else if (event.type === "close") {
            setBusy(false);
          }
        },
      });
    } catch {
      setMessage(`Could not start the ${label} connection. Please try again.`);
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", gap: "8px" }}>
    <button type="button" className="button primary" onClick={connect} disabled={busy}>
      {busy ? `Connecting ${label}…` : `Connect ${label}`}
    </button>
    {message && <p role="status" style={{ margin: 0, fontSize: "12px", color: "#596273" }}>{message}</p>}
  </div>;
}
