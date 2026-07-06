export default function TrustCenterLayout({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "linear-gradient(180deg,#eef2fb 0%,#f7f8fa 42%)", padding: "48px 24px" }}>
    <div style={{ width: "100%", maxWidth: "820px", margin: "0 auto" }}>
      <div className="brand" style={{ marginBottom: "24px" }}><span className="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg></span>ComplianceHub</div>
      {children}
      <footer style={{ marginTop: "32px", fontSize: "12px", color: "#596273" }}>This Trust Center is published by the organisation named above. ComplianceHub supports readiness management; it does not provide ISO certification or legal advice.</footer>
    </div>
  </main>;
}
