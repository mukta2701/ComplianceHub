"use client";

import { useState } from "react";

import type { EvidenceKind } from "../domain/evidence";

export function EvidenceSourceFields({ helpClassName }: { helpClassName?: string }) {
  const [kind, setKind] = useState<EvidenceKind>("file");

  return <>
    <label>Evidence type
      <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as EvidenceKind)}>
        <option value="file">File upload</option>
        <option value="link">Web link</option>
        <option value="note">Recorded note</option>
      </select>
    </label>
    {kind === "file" && <label>File
      <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" />
      <small className={helpClassName}>PDF, PNG, JPG, DOCX, XLSX, CSV or TXT. Maximum 25 MB.</small>
    </label>}
    {kind === "link" && <label>Web address
      <input name="url" type="url" placeholder="https://" />
      <small className={helpClassName}>The saved record opens this source in a separate browser tab.</small>
    </label>}
    {kind === "note" && <p className={helpClassName} role="note">The proof is recorded in the description above. Include the check performed, result and any limits.</p>}
  </>;
}
