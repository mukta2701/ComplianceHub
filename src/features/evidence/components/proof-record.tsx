import Link from "next/link";
import { Pill } from "@/components/ui";
import { deriveEffectiveEvidenceStatus, type EvidenceKind, type EvidenceStatus } from "../domain/evidence";
import styles from "./proof-record.module.css";

const TONE:Record<EvidenceStatus,string> = { current:"green",expiring:"amber",expired:"red",superseded:"neutral",withdrawn:"neutral" };

function displayDate(value:string|null) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeZone:"UTC" }).format(new Date(value)) : "No date";
}

export type ProofRecordData = {
  id:string;
  title:string;
  kind:EvidenceKind;
  status:EvidenceStatus;
  collectedOn:string|null;
  validUntil:string|null;
  sourceLabel?:string|null;
};

export function ProofRecord({ record, today, href = `/app/evidence?evidence=${record.id}#evidence-${record.id}` }: { record:ProofRecordData;today:string;href?:string|null }) {
  const status = deriveEffectiveEvidenceStatus(record.status, record.validUntil, today);
  return <article className={styles.record}>
    <div className={styles.top}><span className={styles.identity}>{href ? <Link href={href}>{record.title}</Link> : <strong>{record.title}</strong>}<small>{record.kind} evidence{record.sourceLabel ? ` · ${record.sourceLabel}` : ""}</small></span><Pill tone={TONE[status]}>{status}</Pill></div>
    <p className={styles.meta}><span>Collected {displayDate(record.collectedOn)}</span><span>Valid until {displayDate(record.validUntil)}</span></p>
    <p className={styles.boundary}>Freshness describes this record. The audit result is a separate human decision.</p>
  </article>;
}
