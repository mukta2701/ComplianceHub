import { redirect } from "next/navigation";
import { hasCapability } from "@/features/organisations/domain/access";
import { Card, PageIntro } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { ASSET_IMPORT_FIELDS } from "@/features/imports/adapters/asset";

export default async function AssetImportPage() {
  const { membership } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_imports")) redirect("/app/assets");
  const fields = ASSET_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="ASSETS" title="Import asset inventory" body="Upload your asset workbook, map its columns, preview the validation, then add the assets. Categories are matched or created for you." />
    <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Choose who is accountable</h2>
      <p style={{ fontSize: "13px", margin: "0 0 8px" }}>Add an optional <strong>In-app owner</strong> column using the person’s display name in this workspace. Names must match one person; capitalisation and surrounding spaces do not matter. Leave it blank to import an unassigned asset.</p>
      <p style={{ fontSize: "13px", margin: "0 0 8px" }}><strong>Owner &amp; Location</strong> stays descriptive and does not assign anyone. Preview flags names that cannot be matched safely; correct those rows before importing them.</p>
      <p style={{ fontSize: "13px", color: "#596273", margin: 0 }}>Existing CSV/XLSX exports omit in-app owners and linked risks. Add an In-app owner column yourself when importing an export; risk links are not restored by this import.</p>
    </Card>
    <ImportWizard module="asset" fields={fields} recordsHref="/app/assets" recordsLabel="asset inventory" />
  </>;
}
