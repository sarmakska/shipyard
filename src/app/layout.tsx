import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "shipyard",
  description:
    "A production-grade multi-tenant SaaS starter: organisations, RBAC, billing, audit log and rate limiting done properly.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
