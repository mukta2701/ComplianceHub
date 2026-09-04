import { redirect } from "next/navigation";
import { hasCapability } from "@/features/organisations/domain/access";
import { PageIntro } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { RISK_IMPORT_FIELDS } from "@/features/imports/adapters/risk";

export default async function RiskImportPage() {
  const { membership } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_imports")) redirect("/app/risks");
  const fields = RISK_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="RISK" title="Import risk register" body="Upload your existing risk-register workbook, map its columns, preview the validation, then add the rows." />
    <ImportWizard module="risk" fields={fields} recordsHref="/app/risks" recordsLabel="risk register" />
  </>;
}
