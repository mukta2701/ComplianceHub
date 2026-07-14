import type { NextConfig } from "next";

// Dev-only: React's development RSC decoder calls eval() for debugging features,
// which the strict production CSP forbids — surfacing a blocking dev error
// overlay. Production keeps script-src without 'unsafe-eval' (React never evals
// in production builds), so the shipped policy is unchanged.
const scriptSrc = process.env.NODE_ENV === "production" ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";

const hostedSupabaseConnectSrc = "'self' https://*.supabase.co wss://*.supabase.co";

export function buildConnectSrc(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  if (!supabaseUrl) return hostedSupabaseConnectSrc;

  try {
    const url = new URL(supabaseUrl);
    // A production-mode build can still be served against the local Supabase
    // stack during release verification. Permit only the exact configured
    // loopback origins; deployed hosted URLs keep the strict hosted policy.
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return hostedSupabaseConnectSrc;

    const websocketUrl = new URL(url.origin);
    websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${hostedSupabaseConnectSrc} ${url.origin} ${websocketUrl.origin}`;
  } catch {
    return hostedSupabaseConnectSrc;
  }
}

const connectSrc = buildConnectSrc();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src ${connectSrc}`,
  },
];

const invitationSecurityHeaders = [
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev-only: the e2e suite and local browsers reach the dev server via
  // 127.0.0.1, which Next.js treats as a disallowed dev origin and rejects
  // the Turbopack HMR websocket, leaving pages unhydrated.
  allowedDevOrigins: ["127.0.0.1"],
  // PDFKit resolves its bundled AFM font metrics at runtime and must remain a
  // native server dependency rather than being folded into Turbopack output.
  serverExternalPackages: ["pdfkit", "exceljs", "docx"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/invite/:path*", headers: invitationSecurityHeaders },
    ];
  },
};

export default nextConfig;
