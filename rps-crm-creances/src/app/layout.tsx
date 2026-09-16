import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RPS CRM Créances",
  description: "Facturation · Recouvrement · Créances — RISSA PETROLEUM SERVICE",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icone.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#EA0000" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
