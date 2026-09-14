"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Pill } from "@/components/ui";
import { OAuthConnectButton } from "./oauth-connect-button";
import {
  addAlertChannelAction,
  configureOAuthConnectionAction,
  revokeAlertChannelAction,
  revokeConnectionAction,
  setAlertChannelEnabledAction,
  setDailyDigestChannelAction,
  setIntegrationConnectionEnabledAction,
} from "./actions";
import {
  disconnectJiraConnectionAction,
  setJiraConnectionEnabledAction,
  syncJiraConnectionAction,
} from "./jira/actions";

export type ConnectionSummary = {
  id: string;
  provider: "github" | "jira";
  label: string;
  config: { owner?: string; repo?: string; baseUrl?: string; projectKey?: string; cloudId?: string };
  connection_mode: "sandbox" | "oauth" | "jira_oauth";
  enabled: boolean;
};

export type NativeJiraConnectionSummary = {
  id: string;
  provider: "jira";
  label: string;
  provider_account_name: string | null;
  enabled: boolean;
  health: "never_synced" | "healthy" | "needs_attention";
  target_count: number;
};

export type AlertChannelSummary = {
  id: string;
  type: string;
  label: string;
  min_severity: string;
  enabled: boolean;
  daily_digest_enabled: boolean;
};

export type DailyDigestDeliverySummary = {
  id: string;
  digest_on: string;
  channel_id: string;
  status: "reserved" | "delivered" | "failed" | "unknown";
  attempt_count: number;
  error_code: string | null;
  last_attempted_at: string;
  delivered_at: string | null;
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
    label: "GitHub Issues",
    mark: "GH",
    description: "Optional: create and track remediation issues in GitHub.",
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

function nativeJiraNeedsSetup(connection: NativeJiraConnectionSummary) {
  return connection.target_count < 1;
}

function providerTargetSummary(
  provider: ProviderId,
  connections: ConnectionSummary[],
  alertChannels: AlertChannelSummary[],
  nativeJiraConnections: NativeJiraConnectionSummary[],
) {
  if (provider === "slack") {
    if (alertChannels.length === 0) return "Not configured";
    if (alertChannels.length > 1) return `${alertChannels.length} channels`;
    return alertChannels[0].label || "Slack channel";
  }
  const providerConnections = connections.filter((connection) => connection.provider === provider);
  if (provider === "jira" && nativeJiraConnections.length > 0) {
    const count = nativeJiraConnections.reduce((total, connection) => total + connection.target_count, 0);
    return count === 1 ? "1 project" : `${count} projects`;
  }
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
  const label = connection.provider === "github" ? "GitHub Issues" : "Jira";
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
  canManageDailyDigest,
  digestDeliveries,
  nativeJiraConnections,
}: {
  provider: ProviderId;
  connections: ConnectionSummary[];
  alertChannels: AlertChannelSummary[];
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
  canManageDailyDigest: boolean;
  digestDeliveries: DailyDigestDeliverySummary[];
  nativeJiraConnections: NativeJiraConnectionSummary[];
}) {
  const metadata = PROVIDERS.find((candidate) => candidate.id === provider)!;
  const providerConnections = connections.filter((connection) => connection.provider === provider);
  const isConnected = provider === "slack"
    ? alertChannels.length > 0
    : providerConnections.length > 0 || (provider === "jira" && nativeJiraConnections.length > 0);
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

    {provider === "slack" ? <SlackPanel
      alertChannels={alertChannels}
      canManageDailyDigest={canManageDailyDigest}
      digestDeliveries={digestDeliveries}
    /> : <SystemPanel
      provider={provider}
      connections={providerConnections}
      nativeJiraConnections={provider === "jira" ? nativeJiraConnections : []}
    />}
  </section>;
}

function SystemPanel({
  provider,
  connections,
  nativeJiraConnections,
}: {
  provider: "github" | "jira";
  connections: ConnectionSummary[];
  nativeJiraConnections: NativeJiraConnectionSummary[];
}) {
  const label = provider === "github" ? "GitHub Issues" : "Jira";

  if (connections.length === 0 && nativeJiraConnections.length === 0) {
    return <div className="connections-panel-empty">
      <p>{provider === "github"
        ? "Connect GitHub, then choose the repository where ComplianceHub may create remediation issues."
        : "Connect your Jira workspace, then choose exactly what ComplianceHub may use."}</p>
      {provider === "jira" ? <a className="button primary" href="/api/integrations/jira/connect">Connect Jira</a> : <OAuthConnectButton provider={provider} />}
    </div>;
  }

  return <div className="connections-account-list">
    {nativeJiraConnections.map((connection) => {
      const needsSetup = nativeJiraNeedsSetup(connection);
      const healthLabel = connection.health === "healthy" ? "Healthy" : connection.health === "needs_attention" ? "Needs attention" : "Not synced";
      return <div className="connections-account" key={connection.id}>
        <div className="connections-account-summary">
          <div>
            <strong>{connection.label || label}</strong>
            <p>{connection.provider_account_name || "Jira workspace"} · {connection.target_count} {connection.target_count === 1 ? "project" : "projects"}</p>
          </div>
          <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <Pill tone={needsSetup ? "amber" : connection.enabled ? "green" : "neutral"}>{needsSetup ? "Setup required" : connection.enabled ? "Active" : "Paused"}</Pill>
            {!needsSetup && <Pill tone={connection.health === "healthy" ? "green" : connection.health === "needs_attention" ? "amber" : "neutral"}>{healthLabel}</Pill>}
          </span>
        </div>
        {needsSetup ? <p className="field-hint">Reconnect Jira to choose at least one project.</p> : <div className="connections-account-actions">
          <ToggleForm id={connection.id} enabled={connection.enabled} label={label} action={setJiraConnectionEnabledAction} />
          <form action={syncJiraConnectionAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button className="button secondary" type="submit">Sync Jira</button>
          </form>
          <form action={disconnectJiraConnectionAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button className="button secondary danger" type="submit">Disconnect</button>
          </form>
        </div>}
      </div>;
    })}
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

function deliveryTone(status: DailyDigestDeliverySummary["status"]) {
  if (status === "delivered") return "green";
  if (status === "reserved") return "blue";
  return status === "failed" ? "amber" : "red";
}

function deliveryLabel(status: DailyDigestDeliverySummary["status"]): string {
  if (status === "delivered") return "Delivered";
  if (status === "reserved") return "In progress";
  if (status === "failed") return "Failed";
  return "Unknown — review Slack";
}

function DigestChannelForm({ channel, pendingChannelId, onSubmit }: {
  channel: AlertChannelSummary;
  pendingChannelId: string | null;
  onSubmit: (channel: AlertChannelSummary, event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const anyPending = pendingChannelId !== null;
  const label = channel.daily_digest_enabled
    ? "Stop daily digest"
    : `Use ${channel.label} for daily digest`;
  return <form onSubmit={(event) => onSubmit(channel, event)}>
    <input type="hidden" name="channelId" value={channel.daily_digest_enabled ? "" : channel.id} />
    <button className="button secondary" type="submit" disabled={anyPending}>
      {pendingChannelId === channel.id ? "Saving daily digest…" : label}
    </button>
  </form>;
}

function formatDeliveryAttempt(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function SlackPanel({ alertChannels, canManageDailyDigest, digestDeliveries }: {
  alertChannels: AlertChannelSummary[];
  canManageDailyDigest: boolean;
  digestDeliveries: DailyDigestDeliverySummary[];
}) {
  const labels = new Map(alertChannels.map((channel) => [channel.id, channel.label]));
  const [digestPendingChannelId, setDigestPendingChannelId] = useState<string | null>(null);
  const [digestMessage, setDigestMessage] = useState("");
  const [digestTransitionPending, startDigestTransition] = useTransition();

  function submitDigestChannel(channel: AlertChannelSummary, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (digestPendingChannelId !== null || digestTransitionPending) return;
    const formData = new FormData(event.currentTarget);
    setDigestMessage("");
    setDigestPendingChannelId(channel.id);
    startDigestTransition(async () => {
      try {
        await setDailyDigestChannelAction(formData);
        setDigestMessage("Daily digest channel updated.");
      } catch {
        setDigestMessage("Could not update the daily digest channel. Try again.");
      } finally {
        setDigestPendingChannelId(null);
      }
    });
  }

  return <div className="connections-slack-panel">
    {alertChannels.length > 0 && <div className="connections-account-list">
      {alertChannels.map((channel) => <div className="connections-account" key={channel.id}>
        <div className="connections-account-summary">
          <div>
            <strong>{channel.label}</strong>
            <p>{channel.min_severity} severity and above</p>
          </div>
          <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <Pill tone={channel.enabled ? "green" : "neutral"}>{channel.enabled ? "Active" : "Paused"}</Pill>
            {channel.daily_digest_enabled && <Pill tone="blue">Daily digest</Pill>}
          </span>
        </div>
        {canManageDailyDigest && <div className="connections-account-actions">
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
          {canManageDailyDigest && (channel.enabled || channel.daily_digest_enabled) && <DigestChannelForm
            channel={channel}
            pendingChannelId={digestPendingChannelId}
            onSubmit={submitDigestChannel}
          />}
        </div>}
      </div>)}
    </div>}

    {digestMessage && <p className="field-hint" role="status" aria-live="polite">{digestMessage}</p>}

    {canManageDailyDigest ? <form action={addAlertChannelAction} className="app-form connections-slack-form">
      <h4>{alertChannels.length > 0 ? "Add another channel" : "Add a channel"}</h4>
      <div className="form-grid">
        <label>Slack destination URL<input name="endpoint" type="url" placeholder="Paste the Slack HTTPS endpoint" required /></label>
        <label>Alert at<select name="minSeverity" defaultValue="high"><option value="low">Low and above</option><option value="medium">Medium and above</option><option value="high">High and above</option><option value="critical">Critical only</option></select></label>
        <label>Channel label<input name="label" maxLength={160} placeholder="#compliance-alerts" /></label>
      </div>
      <button className="button primary" type="submit">Add Slack channel</button>
      <p className="field-hint">The destination is encrypted and never displayed again.</p>
    </form> : <p className="field-hint">A workspace Owner manages Slack destinations.</p>}

    {canManageDailyDigest && <section style={{ marginTop: "20px" }} aria-label="Daily digest delivery history">
      <h4>Recent daily digests</h4>
      {digestDeliveries.length > 0 ? <div className="connections-account-list">
        {digestDeliveries.slice(0, 10).map((delivery) => <div className="connections-account" key={delivery.id}>
          <div className="connections-account-summary">
            <div>
              <strong>{new Date(`${delivery.digest_on}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong>
              <p>{labels.get(delivery.channel_id) ?? "Configured Slack channel"} · Attempt {delivery.attempt_count}</p>
              <p className="field-hint"><time dateTime={delivery.last_attempted_at}>Last attempt {formatDeliveryAttempt(delivery.last_attempted_at)}</time></p>
            </div>
            <Pill tone={deliveryTone(delivery.status)}>{deliveryLabel(delivery.status)}</Pill>
          </div>
          {delivery.error_code && <p className="field-hint">Review code: {delivery.error_code}</p>}
        </div>)}
      </div> : <p className="field-hint">No daily digest delivery attempts yet.</p>}
    </section>}
  </div>;
}

export function ConnectionsCatalog({
  connections,
  alertChannels,
  navigation,
  canManageDailyDigest = false,
  digestDeliveries = [],
  nativeJiraConnections = [],
}: {
  connections: ConnectionSummary[];
  alertChannels: AlertChannelSummary[];
  navigation?: React.ReactNode;
  canManageDailyDigest?: boolean;
  digestDeliveries?: DailyDigestDeliverySummary[];
  nativeJiraConnections?: NativeJiraConnectionSummary[];
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
        const nativeConnections = provider.id === "jira" ? nativeJiraConnections : [];
        const records = provider.id === "slack" ? liveSlackChannels : [...providerConnections, ...nativeConnections];
        const needsSetup = providerConnections.some(connectionNeedsSetup) || nativeConnections.some(nativeJiraNeedsSetup);
        const hasEnabledRecord = records.some((record) => record.enabled);
        const status = records.length === 0
          ? "Not connected"
          : needsSetup
            ? "Setup required"
            : hasEnabledRecord
              ? "Connected"
              : "Paused";
        const action = records.length === 0 ? "Connect" : needsSetup ? "Continue setup" : "Manage";
        const targetSummary = providerTargetSummary(provider.id, connections, liveSlackChannels, nativeJiraConnections);
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
              className={`button ${records.length === 0 || needsSetup ? "primary" : "secondary"}`}
              type="button"
              ref={(element) => { triggerRefs.current[provider.id] = element; }}
              aria-controls="connection-management-panel"
              aria-expanded={selectedProvider === provider.id}
              aria-label={`${action} ${provider.label}`}
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
      canManageDailyDigest={canManageDailyDigest}
      digestDeliveries={digestDeliveries}
      nativeJiraConnections={nativeJiraConnections}
    />}
  </div>;
}
