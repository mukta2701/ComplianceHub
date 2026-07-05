import { PageIntro } from "@/components/ui";
import { createRiskAction } from "../../actions";

export default function NewRiskPage() {
  return <>
    <PageIntro eyebrow="RISK" title="Add risk" body="Record inherent and residual exposure on the documented 5×5 matrix." />
    <form action={createRiskAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required placeholder="e.g. R-001" /></label>
        <label>Title<input name="title" required placeholder="Risk title" /></label>
      </div>
      <label>Description<textarea name="description" required placeholder="Risk description" /></label>
      <div className="form-grid">
        <label>Category<input name="category" required placeholder="Category" /></label>
        <label>Review date<input name="reviewDate" type="date" /></label>
        {[["likelihood", "Likelihood"], ["impact", "Impact"], ["residualLikelihood", "Residual likelihood"], ["residualImpact", "Residual impact"]].map(([name, label]) => <label key={name}>{label}<select name={name} defaultValue="3">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>)}
        <label>Treatment<select name="treatment"><option value="mitigate">Mitigate</option><option value="avoid">Avoid</option><option value="transfer">Transfer</option><option value="accept">Accept</option></select></label>
        <label>Status<select name="status"><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></label>
      </div>
      <label>Treatment plan<textarea name="treatmentPlan" placeholder="Treatment plan" /></label>
      <label>Evidence references<textarea name="evidence" placeholder="Evidence references" /></label>
      <button className="button primary">Save risk</button>
    </form>
  </>;
}
