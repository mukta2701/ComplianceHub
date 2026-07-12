import Link from "next/link";

// App-wide 404. Rendered within the root layout, so globals.css applies.
export default function NotFound() {
  return (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: "40px 24px", textAlign: "center" }}>
      <div style={{ maxWidth: 440 }}>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", color: "#2f6bed" }}>404</div>
        <h1 style={{ fontSize: 22, margin: "6px 0 8px" }}>Page not found</h1>
        <p style={{ fontSize: 14, color: "#596273", lineHeight: 1.55, margin: "0 0 22px" }}>The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.</p>
        <Link className="button" href="/app">Go to dashboard</Link>
      </div>
    </div>
  );
}
