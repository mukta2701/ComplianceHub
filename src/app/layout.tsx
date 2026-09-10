import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComplianceHub — ISO 27001 readiness made practical",
  description: "Plain-English ISO 27001 readiness assessments, Statement of Applicability exports, and risk management for UK teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
