"use client";

import { useEffect, useRef, useState } from "react";
import { Pill } from "@/components/ui";
import { OAuthConnectButton } from "./oauth-connect-button";
import {
  addAlertChannelAction,
  configureOAuthConnectionAction,
  revokeAlertChannelAction,
  revokeConnectionAction,
  setAlertChannelEnabledAction,
  setIntegrationConnectionEnabledAction,
} from "./actions";

export type ConnectionSummary = {
  id: string;
  provider: "github" | "jira";
  label: string;
  config: { owner?: string; repo?: string; baseUrl?: string; projectKey?: string; cloudId?: string };
  connection_mode: "sandbox" | "oauth";
  enabled: boolean;
};

export type AlertChannelSummary = {
  id: string;
  type: string;
  label: string;
  min_severity: string;
  enabled: boolean;
};

type ProviderId = "github" | "jira" | "slack";

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  mark: string;
  description: string;
}> = [
  {
    id: "github",
    label: "GitHub",
    mark: "GH",
    description: "Monitor repositories and security controls.",
  },
  {
    id: "jira",
    label: "Jira",
    mark: "JI",
    description: "Track remediation work in your Jira projects.",
  },
  {
    id: "slack",
    label: "Slack",
    mark: "SL",
    description: "Send new finding alerts to your team.",
  },
];

function connectionNeedsSetup(connection: ConnectionSummary) {
  if (connection.connection_mode !== "oauth") return false;
  if (connection.provider === "github") {
    return !(connection.config.owner && connection.config.repo);
  }
  return !connection.config.cloudId;
}

function providerTargetSummary(
  provider: ProviderId,
  connections: ConnectionSummary[],
  alertChannels: AlertChannelSummary[],
) {
  if (provider === "slack") {
    if (alertChannels.length === 0) return "Not configured";
    if (alertChannels.length > 1) return `${alertChannels.length} channels`;
    return alertChannels[0].label || "Slack channel";
  }
  const providerConnections = connections.filter((connection) => connection.provider === provider);
  if (providerConnections.length === 0) return "Not configured";
  if (providerConnections.length > 1) return `${providerConnections.length} connections`;
  const connection = providerConnections[0];
  if (connectionNeedsSetup(connection)) {
    return provider === "github" ? "Repository not selected" : "Project not selected";
  }
  if (provider === "github") {
    return [connection.config.owner, connection.config.repo].filter(Boolean).join("/")
      || connection.label
      || "GitHub connection";
  }
  return connection.config.projectKey
    || connection.label
    || connection.config.baseUrl
    || "Jira connection";
}

function ToggleForm({
  id,
  enabled,
  label,
  action,
}: {
  id: string;
  enabled: boolean;
  label: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return <form action={action}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="enabled" value={String(!enabled)} />
    <button className="button secondary" type="submit">
      {enabled ? `Pause ${label}` : `Enable ${label}`}
    </button>
  </form>;
}

function ProviderTargetForm({ connection }: { connection: ConnectionSummary }) {
  const label = connection.provider === "github" ? "GitHub" : "Jira";
  return <form action={configureOAuthConnectionAction} className="app-form connections-target-form">
    <input type="hidden" name="id" value={connection.id} />
    <input type="hidden" name="provider" value={connection.provider} />
    <p className="connections-panel-copy">
      Choose the {connection.provider === "github" ? "repository" : "project"} ComplianceHub may use.
    </p>
    <div className="form-grid">
      {connection.provider === "github" ? <>
        <label>GitHub owner<input name="owner" maxLength={39} placeholder="acme" required /></label>
        <label>Repository<input name="repo" maxLength={100} placeholder="isms" required /></label>
      </> : <>
        <label>Jira Cloud URL<input name="baseUrl" type="url" maxLength={300} placeholder="https://acme.atlassian.net" required /></label>
        <label>Project key<input name="projectKey" maxLength={80} placeholder="SEC" required /></label>
      </>}
    </div>
    <button className="button primary" type="submit">Save and enable {label}</button>
  </form>;
}

function ProviderPanel({
  provider,
  connections,
  alertChannels,
  onClose,
  panelRef,
}: {
  provider: ProviderId;
  connections: ConnectionSummary[];
  alertChannels: AlertChannelSummary[];
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
}) {
  const metadata = PROVIDERS.find((candidate) => candidate.id === provider)!;
  const providerConnections = connections.filter((connection) => connection.provider === provider);
  const isConnected = provider === "slack" ? alertChannels.length > 0 : providerConnections.length > 0;
  const panelVerb = isConnected ? "Manage" : "Connect";

  return <section
    className="connections-panel connection-management"
    id="connection-management-panel"
    ref={panelRef}
    role="region"
    tabIndex={-1}
    aria-label={`${panelVerb} ${metadata.label}`}
  >
    <div className="connections-panel-head">
      <div className="connections-provider-heading">
        <span className={`connections-provider-mark connection-icon ${provider}`} aria-hidden="true">{metadata.mark}</span>
        <div>
          <h3>{panelVerb} {metadata.label}</h3>
          <p>{metadata.description}</p>
        </div>
      </div>
      <button className="connections-panel-close" type="button" onClick={onClose} aria-label={`Close ${metadata.label} panel`}>
        <span aria-hidden="true">×</span>
      </button>
    </div>

    {provider === "slack" ? <SlackPanel alertChannels={alertChannels} /> : <SystemPanel
      provider={provider}
      connections={providerConnections}
    />}
  </section>;
}

function SystemPanel({
  provider,
  connections,
}: {
  provider: "github" | "jira";
  connections: ConnectionSummary[];
}) {
  const label = provider === "github" ? "GitHub" : "Jira";

  if (connections.length === 0) {
    return <div className="connections-panel-empty">
      <p>Connect your {label} workspace, then choose exactly what ComplianceHub may monitor.</p>
      <OAuthConnectButton provider={provider} />
    </div>;
  }

  return <div className="connections-account-list">
    {connections.map((connection) => {
      const needsSetup = connectionNeedsSetup(connection);
      const target = provider === "github"
        ? [connection.config.owner, connection.config.repo].filter(Boolean).join("/")
        : connection.config.projectKey || connection.config.baseUrl || "Project not selected";
      return <div className="connections-account" key={connection.id}>
        <div className="connections-account-summary">
          <div>
            <strong>{connection.label || label}</strong>
            <p>{target || "Repository not selected"}</p>
          </div>
          <Pill tone={needsSetup ? "amber" : connection.enabled ? "green" : "neutral"}>
            {needsSetup ? "Setup required" : connection.enabled ? "Active" : "Paused"}
          </Pill>
        </div>
        {needsSetup ? <ProviderTargetForm connection={connection} /> : <div className="connections-account-actions">
          <ToggleForm
            id={connection.id}
            enabled={connection.enabled}
            label={label}
            action={setIntegrationConnectionEnabledAction}
          />
          <form action={revokeConnectionAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button className="button secondary danger" type="submit">Disconnect</button>
          </form>
        </div>}
      </div>;
    })}
  </div>;
}

function SlackPanel({ alertChannels }: { alertChannels: AlertChannelSummary[] }) {
  return <div className="connections-slack-panel">
    {alertChannels.length > 0 && <div className="connections-account-list">
      {alertChannels.map((channel) => <div className="connections-account" key={channel.id}>
        <div className="connections-account-summary">
          <div>
            <strong>{channel.label}</strong>
            <p>{channel.min_severity} severity and above</p>
          </div>
          <Pill tone={channel.enabled ? "green" : "neutral"}>{channel.enabled ? "Active" : "Paused"}</Pill>
        </div>
        <div className="connections-account-actions">
          <ToggleForm
            id={channel.id}
            enabled={channel.enabled}
            label={channel.label}
            action={setAlertChannelEnabledAction}
          />
          <form action={revokeAlertChannelAction}>
            <input type="hidden" name="id" value={channel.id} />
            <button className="button secondary danger" type="submit">Remove</button>
          </form>
        </div>
      </div>)}
    </div>}

    <form action={addAlertChannelAction} className="app-form connections-slack-form">
      <h4>{alertChannels.length > 0 ? "Add another channel" : "Add a channel"}</h4>
      <div className="form-grid">
        <label>Slack destination URL<input name="endpoint" type="url" placeholder="Paste the Slack HTTPS endpoint" required /></label>
        <label>Alert at<select name="minSeverity" defaultValue="high"><option value="low">Low and above</option><option value="medium">Medium and above</option><option value="high">High and above</option><option value="critical">Critical only</option></select></label>
        <label>Channel label<input name="label" maxLength={160} placeholder="#compliance-alerts" /></label>
      </div>
      <button className="button primary" type="submit">Add Slack channel</button>
      <p className="field-hint">The destination is encrypted and never displayed again.</p>
    </form>
  </div>;
}

export function ConnectionsCatalog({ connections, alertChannels, navigation }: {
  connections: ConnectionSummary[];
  alertChannels: AlertChannelSummary[];
  navigation?: React.ReactNode;
}) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef<Record<ProviderId, HTMLButtonElement | null>>({ github: null, jira: null, slack: null });
  const liveSlackChannels = alertChannels.filter((channel) => channel.type === "slack");

  useEffect(() => {
    if (!selectedProvider || !panelRef.current) return;
    panelRef.current.focus({ preventScroll: true });
    panelRef.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [selectedProvider]);

  function closeProviderPanel() {
    if (selectedProvider) triggerRefs.current[selectedProvider]?.focus();
    setSelectedProvider(null);
  }

  return <div className="connections-catalog">
    <header className="connections-catalog-head">
      <div>
        <p className="eyebrow">SETTINGS · CONNECTIONS</p>
        <h2>Connections</h2>
        <p>Connect the tools your compliance workspace relies on.</p>
      </div>
    </header>

    {navigation}

    <div className="connections-provider-grid connections-grid" data-testid="connections-grid">
      {PROVIDERS.map((provider) => {
        const providerConnections = connections.filter((connection) => connection.provider === provider.id);
        const records = provider.id === "slack" ? liveSlackChannels : providerConnections;
        const needsSetup = providerConnections.some(connectionNeedsSetup);
        const status = records.length === 0 ? "Not connected" : needsSetup ? "Setup required" : "Connected";
        const action = records.length === 0 ? "Connect" : needsSetup ? "Continue setup" : "Manage";
        const targetSummary = providerTargetSummary(provider.id, connections, liveSlackChannels);
        return <article className="connections-provider-card connection-card" aria-label={`${provider.label} connection`} key={provider.id}>
          <div className="connections-provider-heading connection-card-head">
            <span className={`connections-provider-mark connection-icon ${provider.id}`} aria-hidden="true">{provider.mark}</span>
            <div>
              <h3>{provider.label}</h3>
              <span className="connection-status"><Pill tone={status === "Connected" ? "green" : status === "Setup required" ? "amber" : "neutral"}>{status}</Pill></span>
            </div>
          </div>
          <p>{provider.description}</p>
          <div className="connection-card-footer">
            <span className="connection-card-target">{targetSummary}</span>
            <button
              className="button secondary"
              type="button"
              ref={(element) => { triggerRefs.current[provider.id] = element; }}
              aria-controls="connection-management-panel"
              aria-expanded={selectedProvider === provider.id}
              onClick={() => setSelectedProvider(provider.id)}
            >{action}</button>
          </div>
        </article>;
      })}
    </div>

    {selectedProvider && <ProviderPanel
      provider={selectedProvider}
      connections={connections}
      alertChannels={liveSlackChannels}
      panelRef={panelRef}
      onClose={closeProviderPanel}
    />}
  </div>;
}
