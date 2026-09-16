import Link from "next/link";
import { seConnecter, creerCompte } from "./actions";

export default async function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; info?: string; suivant?: string; onglet?: string }>;
}) {
  const sp = await searchParams;
  const inscription = sp.onglet === "inscription";
  const messageErreur =
    sp.erreur === "compte_inactif" ? "Votre compte est désactivé. Contactez un administrateur." : sp.erreur;

  return (
    <div className="connexion">
      <div className="carte">
        <div className="marque">
          <h1>CRM Recouvrement</h1>
          <p>Facturation · Créances · Relances</p>
        </div>
        <div className="onglets">
          <Link href="/login" className={!inscription ? "actif" : ""}>Connexion</Link>
          <Link href="/login?onglet=inscription" className={inscription ? "actif" : ""}>Créer un compte</Link>
        </div>
        {messageErreur && <div className="alerte erreur">{messageErreur}</div>}
        {sp.info && <div className="alerte info">{sp.info}</div>}
        {inscription ? (
          <form action={creerCompte} className="form">
            <div className="champ">
              <label htmlFor="nom">Nom complet</label>
              <input id="nom" name="nom" required autoComplete="name" />
            </div>
            <div className="champ">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="champ">
              <label htmlFor="mot_de_passe">Mot de passe</label>
              <input id="mot_de_passe" name="mot_de_passe" type="password" required minLength={8} autoComplete="new-password" />
              <span className="aide">Le premier compte créé devient administrateur.</span>
            </div>
            <button className="btn primary" type="submit">Créer mon compte</button>
          </form>
        ) : (
          <form action={seConnecter} className="form">
            <input type="hidden" name="suivant" value={sp.suivant ?? "/dashboard"} />
            <div className="champ">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="champ">
              <label htmlFor="mot_de_passe">Mot de passe</label>
              <input id="mot_de_passe" name="mot_de_passe" type="password" required autoComplete="current-password" />
            </div>
            <button className="btn primary" type="submit">Se connecter</button>
          </form>
        )}
      </div>
    </div>
  );
}
