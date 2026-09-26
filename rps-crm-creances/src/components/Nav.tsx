"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ONGLETS = [
  { href: "/dashboard", libelle: "TABLEAU DE BORD" },
  { href: "/clients", libelle: "CLIENTS" },
  { href: "/recouvrement", libelle: "RECOUVREMENT" },
  { href: "/facturation", libelle: "FACTURATION" },
  { href: "/source", libelle: "SOURCE" },
  { href: "/parametres", libelle: "PARAMÈTRES" },
];

export function Nav() {
  const chemin = usePathname();
  return (
    <nav className="onglets">
      {ONGLETS.map((o) => (
        <Link key={o.href} href={o.href} className={chemin.startsWith(o.href) ? "on" : ""}>{o.libelle}</Link>
      ))}
    </nav>
  );
}
