import type { riskInputSchema } from "@/features/risks/application/risk";

type Values = Partial<ReturnType<typeof riskInputSchema.parse>>;
type Props = {
  action: (formData: FormData) => void | Promise<void>;
  categories: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  values?: Values;
  riskId?: string;
};

export function RiskForm({ action, categories, owners, values = {}, riskId }: Props) {
  return <form action={action} className="card app-form">
    {riskId && <input type="hidden" name="id" value={riskId} />}
    {!riskId && values.sourceAssessmentSessionId && <input type="hidden" name="sourceAssessmentSessionId" value={values.sourceAssessmentSessionId} />}
    <div className="form-grid">
      <label>Reference<input name="reference" required maxLength={40} placeholder="e.g. R-001" defaultValue={values.reference ?? ""} /></label>
      <label>Title<input name="title" required maxLength={200} placeholder="Risk title" defaultValue={values.title ?? ""} /></label>
    </div>
    <label>Description<textarea name="description" required maxLength={10000} placeholder="Risk description" defaultValue={values.description ?? ""} /></label>
    <div className="form-grid">
      <label>Category<select name="categoryId" required defaultValue={values.categoryId ?? ""}><option value="" disabled>Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Owner<select name="ownerId" defaultValue={values.ownerId ?? ""}><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label>Review date<input name="reviewDate" type="date" defaultValue={values.reviewDate ?? ""} /></label>
      {([["likelihood", "Likelihood"], ["impact", "Impact"], ["residualLikelihood", "Residual likelihood"], ["residualImpact", "Residual impact"]] as const).map(([name, label]) => <label key={name}>{label}<select name={name} defaultValue={String(values[name] ?? 3)}>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></label>)}
      <label>Treatment<select name="treatment" defaultValue={values.treatment ?? "mitigate"}><option value="mitigate">Mitigate</option><option value="avoid">Avoid</option><option value="transfer">Transfer</option><option value="accept">Accept</option></select></label>
      <label>Status<select name="status" defaultValue={values.status ?? "open"}><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></label>
    </div>
    <label>Treatment plan<textarea name="treatmentPlan" maxLength={10000} placeholder="Treatment plan" defaultValue={values.treatmentPlan ?? ""} /></label>
    <label>Evidence references<textarea name="evidence" maxLength={10000} placeholder="Evidence references" defaultValue={values.evidence ?? ""} /></label>
    <button className="button primary">{riskId ? "Save changes" : "Save risk"}</button>
  </form>;
}
