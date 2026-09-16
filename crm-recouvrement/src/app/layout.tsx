import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Recouvrement",
  description: "Facturation, suivi de créances et recouvrement automatisé",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
