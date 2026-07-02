import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev-only: the e2e suite and local browsers reach the dev server via
  // 127.0.0.1, which Next.js treats as a disallowed dev origin and rejects
  // the Turbopack HMR websocket, leaving pages unhydrated.
  allowedDevOrigins: ["127.0.0.1"],
  // PDFKit resolves its bundled AFM font metrics at runtime and must remain a
  // native server dependency rather than being folded into Turbopack output.
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
