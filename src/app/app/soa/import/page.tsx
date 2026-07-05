import { PageIntro, Card } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { SOA_IMPORT_FIELDS } from "@/features/imports/adapters/soa";

export default async function SoaImportPage() {
  const { supabase } = await requireAppContext();
  const { data: registers } = await supabase.from("soa_registers").select("id,title").order("updated_at", { ascending: false });
  const fields = SOA_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="SOA" title="Import Statement of Applicability" body="Upload your SoA workbook to update applicability, status, justification and owner on controls that already exist in the selected register. Rows for unknown controls are reported, not added." />
    {registers?.length ? <ImportWizard module="soa" fields={fields} recordsHref="/app/soa" recordsLabel="Statement of Applicability" registers={registers} />
      : <Card style={{ padding: "22px" }}><p style={{ fontSize: "13px", color: "#596273" }}>Generate a SoA draft first — imports update existing controls rather than creating a register.</p></Card>}
  </>;
}
