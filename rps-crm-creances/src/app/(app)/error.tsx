"use client";

import Link from "next/link";
import { traduireErreur } from "@/lib/erreurs";

/** Une panne n'est jamais un écran vide rassurant : on dit ce qui manque et depuis quand. */
export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" style={{ borderLeft: "4px solid var(--rouge)" }}>
      <h3>Le CRM ne peut pas afficher cette page</h3>
      <p>{traduireErreur(error)}</p>
      <p className="muted">Aucun chiffre n&apos;est estimé : si le serveur de données ne répond pas, seules les dernières données datées sont fiables.</p>
      <div className="frm"><button className="btn pr" onClick={() => reset()}>Réessayer</button><Link className="btn" href="/dashboard">Tableau de bord</Link></div>
    </div>
  );
}
