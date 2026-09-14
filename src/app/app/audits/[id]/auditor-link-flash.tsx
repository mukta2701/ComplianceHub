"use client";

import { useEffect,useState } from "react";
import { Card } from "@/components/ui";
import styles from "../audit-workspace.module.css";

export function AuditorLinkFlash({ auditId }: { auditId:string }) {
  const [link,setLink] = useState<string|null>(null);
  const [failed,setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/app/audits/${auditId}/auditor-link`, { cache:"no-store",signal:controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not retrieve the new auditor link");
        return response.json() as Promise<{link:string|null}>;
      })
      .then((payload) => {
        setLink(payload.link);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  },[auditId]);
  if (link) return <Card role="status" className={styles.shareStatus}><b>New link — copy now</b><code>{link}</code></Card>;
  if (failed) return <Card role="alert" className={`${styles.shareStatus} ${styles.shareError}`}><b>New link could not be shown</b><span>Revoke the active link listed below, then create a new one.</span></Card>;
  return null;
}
