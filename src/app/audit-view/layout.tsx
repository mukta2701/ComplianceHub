import styles from "./audit-view.module.css";

export default function AuditViewLayout({ children }: { children: React.ReactNode }) {
  return <main className={styles.shell}>
    <div className={styles.container}>
      <div className={styles.brand}><span className={styles.brandMark}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg></span>ComplianceHub</div>
      {children}
      <footer className={styles.footer}>Read-only auditor view. ComplianceHub supports readiness management; it does not provide ISO certification or legal advice.</footer>
    </div>
  </main>;
}
