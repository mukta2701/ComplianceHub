import { Card } from "@/components/ui";
import { configureJiraProjectsAction, selectJiraSiteAction } from "./jira/actions";

export type JiraSetupSite = {
  cloudId: string;
  name: string;
  url: string;
};

export type JiraSetupProject = {
  id: string;
  key: string;
  name: string;
};

export function JiraSetupPanel({
  step,
  setupId,
  connectionId,
  sites = [],
  projects = [],
}: {
  step: "site" | "project";
  setupId?: string;
  connectionId?: string;
  sites?: JiraSetupSite[];
  projects?: JiraSetupProject[];
}) {
  if (step === "site") {
    return <Card style={{ padding: "20px", margin: "0 auto 16px", maxWidth: "1100px" }} aria-label="Choose Jira site">
      <h2 style={{ marginTop: 0 }}>Choose your Jira site</h2>
      <p>Select the Atlassian site where ComplianceHub should read compliance work.</p>
      {sites.length > 0 ? <form action={selectJiraSiteAction} className="app-form">
        <input type="hidden" name="setupId" value={setupId} />
        <fieldset>
          <legend>Available Jira sites</legend>
          {sites.map((site) => <label key={site.cloudId} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginTop: "10px" }}>
            <input type="radio" name="cloudId" value={site.cloudId} required />
            <span><strong>{site.name}</strong><small style={{ display: "block", color: "#596273" }}>{site.url}</small></span>
          </label>)}
        </fieldset>
        <button className="button primary" type="submit">Continue to projects</button>
      </form> : <p role="status">No Jira sites are available for this authorization. Reconnect Jira and try again.</p>}
    </Card>;
  }

  return <Card style={{ padding: "20px", margin: "0 auto 16px", maxWidth: "1100px" }} aria-label="Choose Jira projects">
    <h2 style={{ marginTop: 0 }}>Choose Jira projects</h2>
    <p>ComplianceHub will monitor selected projects and use them for remediation tracking.</p>
    {projects.length > 0 ? <form action={configureJiraProjectsAction} className="app-form">
      <input type="hidden" name="connectionId" value={connectionId} />
      <fieldset>
        <legend>Projects to include</legend>
        {projects.map((project) => <label key={project.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginTop: "10px" }}>
          <input type="checkbox" name="projectId" value={project.id} />
          <span><strong>{project.key} · {project.name}</strong></span>
        </label>)}
      </fieldset>
      <button className="button primary" type="submit">Save projects</button>
    </form> : <p role="status">No Jira projects are available for this site.</p>}
  </Card>;
}
