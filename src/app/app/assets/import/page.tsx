import { PageIntro } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { ASSET_IMPORT_FIELDS } from "@/features/imports/adapters/asset";

export default async function AssetImportPage() {
  await requireAppContext();
  const fields = ASSET_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="ASSETS" title="Import asset inventory" body="Upload your asset workbook, map its columns, preview the validation, then add the assets. Categories are matched or created for you." />
    <ImportWizard module="asset" fields={fields} recordsHref="/app/assets" recordsLabel="asset inventory" />
  </>;
}
