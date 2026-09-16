import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "RPS CRM Créances", description: "Facturation · Recouvrement · Créances — RISSA PETROLEUM SERVICE" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
