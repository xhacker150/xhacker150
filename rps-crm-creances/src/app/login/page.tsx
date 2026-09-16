import Link from "next/link";
import { seConnecter, creerCompte } from "./actions";

export default async function PageConnexion({ searchParams }: { searchParams: Promise<{ erreur?: string; info?: string; suivant?: string; onglet?: string }> }) {
  const sp = await searchParams;
  const inscription = sp.onglet === "inscription";
  const erreur = sp.erreur === "compte_inactif" ? "Votre compte est désactivé. Contactez la Direction générale." : sp.erreur;
  return (
    <div className="connexion">
      <div className="card">
        <div className="logo"><b>RPS</b> <span>CRM CRÉANCES</span></div>
        <div className="sub">Facturation · Recouvrement · Créances</div>
        <nav className="onglets" style={{ position: "static", marginBottom: 12 }}>
          <Link href="/login" className={!inscription ? "on" : ""}>Connexion</Link>
          <Link href="/login?onglet=inscription" className={inscription ? "on" : ""}>Créer mon compte</Link>
        </nav>
        {erreur && <div className="warn">{erreur}</div>}
        {sp.info && <div className="info">{sp.info}</div>}
        {inscription ? (
          <form action={creerCompte}>
            <label className="ch">Nom et prénom<input name="nom" required autoComplete="name" /></label>
            <label className="ch">E-mail professionnel<input name="email" type="email" required autoComplete="email" /></label>
            <label className="ch">Mot de passe (8 caractères minimum)<input name="mot_de_passe" type="password" required minLength={8} autoComplete="new-password" /></label>
            <p className="note">Comptes nominatifs, jamais partagés. Le premier compte créé est la Direction générale ; les suivants sont en lecture jusqu&apos;à attribution d&apos;un rôle.</p>
            <button className="btn pr" type="submit">Créer mon compte</button>
          </form>
        ) : (
          <form action={seConnecter}>
            <input type="hidden" name="suivant" value={sp.suivant ?? "/dashboard"} />
            <label className="ch">E-mail<input name="email" type="email" required autoComplete="email" /></label>
            <label className="ch">Mot de passe<input name="mot_de_passe" type="password" required autoComplete="current-password" /></label>
            <button className="btn pr" type="submit">Se connecter</button>
          </form>
        )}
      </div>
    </div>
  );
}
