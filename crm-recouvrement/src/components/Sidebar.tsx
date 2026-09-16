"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LIENS = [
  { section: "Pilotage" },
  { href: "/dashboard", ico: "◫", libelle: "Tableau de bord" },
  { href: "/creances", ico: "⏱", libelle: "Balance âgée" },
  { section: "Opérations" },
  { href: "/clients", ico: "☺", libelle: "Clients" },
  { href: "/factures", ico: "▤", libelle: "Factures" },
  { href: "/reglements", ico: "◈", libelle: "Règlements" },
  { href: "/recouvrement", ico: "☎", libelle: "Recouvrement" },
  { section: "Configuration" },
  { href: "/scenarios", ico: "⇶", libelle: "Scénarios de relance" },
  { href: "/import", ico: "⇅", libelle: "Import / Export Sage" },
  { href: "/parametres", ico: "⚙", libelle: "Paramètres" },
];

export function Sidebar({ nom, role, deconnexion }: { nom: string; role: string; deconnexion: () => Promise<void> }) {
  const chemin = usePathname();
  return (
    <aside className="sidebar">
      <div className="marque">
        <span>€</span>
        <div>
          CRM Recouvrement
          <small>Facturation & créances</small>
        </div>
      </div>
      <nav>
        {LIENS.map((l, i) =>
          "section" in l ? (
            <div className="section" key={i}>{l.section}</div>
          ) : (
            <Link key={l.href} href={l.href} className={chemin.startsWith(l.href) ? "actif" : ""}>
              <span className="ico">{l.ico}</span>
              {l.libelle}
            </Link>
          )
        )}
      </nav>
      <div className="pied">
        <strong>{nom}</strong>
        <span>{role}</span>
        <form action={deconnexion}>
          <button className="btn petit" type="submit">Se déconnecter</button>
        </form>
      </div>
    </aside>
  );
}
