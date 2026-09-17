import { seConnecter } from "./actions";

export default async function PageConnexion({ searchParams }: { searchParams: Promise<{ erreur?: string; suivant?: string }> }) {
  const sp = await searchParams;
  const erreur = sp.erreur === "compte_inactif" ? "Votre compte n'est pas encore activé. La Direction générale doit vous attribuer un rôle."
    : sp.erreur === "identifiants" ? "Identifiants incorrects." : sp.erreur ? "Connexion impossible." : null;
  return (
    <div className="connexion">
      <div className="card">
        <div className="logo"><b>RPS</b> <span>CRM CRÉANCES</span></div>
        <div className="sub">Facturation · Recouvrement · Créances</div>
        {erreur && <div className="warn">{erreur}</div>}
        <form action={seConnecter}>
          <input type="hidden" name="suivant" value={sp.suivant ?? "/dashboard"} />
          <label className="ch">E-mail<input name="email" type="email" required autoComplete="email" /></label>
          <label className="ch">Mot de passe<input name="mot_de_passe" type="password" required autoComplete="current-password" /></label>
          <button className="btn pr" type="submit">Se connecter</button>
        </form>
        <p className="note">Comptes nominatifs, jamais partagés. Pas d&apos;inscription en ligne : les comptes sont créés et activés par la Direction générale.</p>
      </div>
    </div>
  );
}
