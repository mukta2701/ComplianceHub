import { Card } from "@/components/ui";
import type { GitHubComplianceControlRoom } from "../application/github-compliance-control-room";
import { countGitHubOfficialOutcomes } from "../domain/compliance-control-room-state";

type OfficialResults = GitHubComplianceControlRoom["repositories"][number]["officialResults"];

export function GitHubOfficialResultSummary({ results }: { results: OfficialResults }) {
  if (results.length === 0) return null;
  const counts = countGitHubOfficialOutcomes(results);
  const currentTotal = counts.current.pass + counts.current.fail + counts.current.unknown + counts.current.notApplicable;
  const hasExcludedResults = counts.historical > 0 || counts.stale > 0;

  return <Card
    className="github-check-summary"
    role="note"
    aria-label="Current GitHub results summary"
    style={{ marginTop: "12px", padding: "14px 18px", fontSize: "13px", fontWeight: 700 }}
  >
    <p className="github-check-summary-current">
      <strong>{currentTotal} current GitHub {currentTotal === 1 ? "result" : "results"} across repositories shown here</strong>
      {" · "}{counts.current.pass} passed
      {" · "}{counts.current.fail} {counts.current.fail === 1 ? "needs" : "need"} action
      {" · "}{counts.current.unknown} could not be verified
      {counts.current.notApplicable > 0 && <> · {counts.current.notApplicable} not applicable</>}
    </p>
    {hasExcludedResults && <p className="github-check-summary-excluded">
      {counts.historical > 0 && <>{counts.historical} historical {counts.historical === 1 ? "result" : "results"}</>}
      {counts.historical > 0 && counts.stale > 0 && " · "}
      {counts.stale > 0 && <>{counts.stale} stale {counts.stale === 1 ? "result" : "results"}</>}
      {" (excluded from current totals; details remain below)"}
    </p>}
  </Card>;
}
