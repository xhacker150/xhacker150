import { Nav } from "@/components/Nav";
import { exigerProfil, extractionActive, lireParametres } from "@/lib/session";
import { LIBELLES_ROLE, formatDate, jours } from "@/lib/format";
import { seDeconnecter } from "@/app/login/actions";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ profil }, extraction, parametres] = await Promise.all([exigerProfil(), extractionActive(), lireParametres()]);
  const age = extraction ? jours(extraction.date_extraction) ?? 0 : null;
  const perimee = age !== null && age > (parametres.seuils.peremption_donnees_jours ?? 1);
  return (
    <>
      <header className="entete">
        <div>
          <div className="logo"><b>RPS</b> <span>CRM CRÉANCES</span></div>
          <div className="sub">Facturation · Recouvrement · Créances — {parametres.societe.nom}</div>
        </div>
        <div className="sp" />
        <span id="src">
          {extraction ? (
            <>Données du <b>{formatDate(extraction.date_extraction)}</b>{extraction.saisi_jusquau ? <> · saisi jusqu&apos;au <b>{formatDate(extraction.saisi_jusquau)}</b></> : null} · {extraction.source === "api" ? "API du pont" : "fichiers du pont"}</>
          ) : (
            <Link href="/source">Source : non chargée</Link>
          )}
        </span>
        <div className="utilisateur">
          <b>{profil.nom}</b>
          {LIBELLES_ROLE[profil.role]}
        </div>
        <form action={seDeconnecter}><button className="btn sm" type="submit">Quitter</button></form>
      </header>
      <Nav />
      <main>
        {perimee && extraction && (
          <div className="warn">⚠ Données du {formatDate(extraction.date_extraction)} ({age} jours) : l&apos;extraction du pont n&apos;a pas été reçue aujourd&apos;hui. Les chiffres affichés sont ceux de cette date, aucune estimation n&apos;est faite.</div>
        )}
        {children}
      </main>
    </>
  );
}
