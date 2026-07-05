import { PageIntro } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { RISK_IMPORT_FIELDS } from "@/features/imports/adapters/risk";

export default async function RiskImportPage() {
  await requireAppContext();
  const fields = RISK_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="RISK" title="Import risk register" body="Upload your existing risk-register workbook, map its columns, preview the validation, then add the rows." />
    <ImportWizard module="risk" fields={fields} recordsHref="/app/risks" recordsLabel="risk register" />
  </>;
}
