/** Erreurs : jamais un message brut de la base dans l'interface ; des codes courts, traduits en français. */
export class ErreurApplicative extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

const TRADUCTIONS: [RegExp, string][] = [
  [/Montant promis inférieur/i, "Le montant promis doit couvrir au moins la part minimale du solde : enregistrez plutôt un plan de paiement."],
  [/Client créditeur/i, "Ce client est créditeur : aucune relance n'est possible."],
  [/décision du DG/i, "Le passage en contentieux (et sa sortie) est une décision de la Direction générale."],
  [/pré-contentieuse/i, "Étape pré-contentieuse obligatoire : générez d'abord la mise en demeure."],
  [/Droits insuffisants|réservé|Réservé|Seul le DG/i, "Vos droits ne permettent pas cette action."],
  [/limite de crédit/i, "La limite de crédit est fixée par la Direction générale."],
  [/Suppression interdite/i, "Rien ne se supprime : fermez l'élément avec un motif."],
  [/Extraction partielle/i, "Extraction partielle : activation refusée pour ne pas fermer des actions à tort. Vérifiez les fichiers ou forcez (DG)."],
  [/ligne\(s\) rejetée/i, "Des lignes ont été rejetées (hors périmètre, date ou montant invalides) : corrigez le fichier ou forcez (DG)."],
  [/antérieure à l'extraction active/i, "Cette extraction est plus ancienne que celle en place : refusée."],
  [/Extraction incomplète/i, "Extraction incomplète : le nombre de lignes reçues diffère des totaux annoncés par le pont."],
  [/ne se date pas dans le futur/i, "Une action ne peut pas être datée dans le futur."],
  [/exige un montant et une échéance/i, "Une promesse exige un montant et une échéance."],
  [/au moins une échéance/i, "Un plan de paiement exige au moins une échéance."],
  [/Compte .* inconnu/i, "Ce compte n'existe pas dans l'extraction active."],
  [/duplicate key|ux_action_ouverte/i, "Une action du même type est déjà ouverte pour ce client : fermez-la d'abord."],
  [/row-level security|permission denied|insufficient_privilege/i, "Vos droits ne permettent pas cette opération."],
  [/JWT|not authenticated|Auth session missing/i, "Session expirée : reconnectez-vous."],
  [/fetch failed|ECONNREFUSED|network/i, "Le serveur de données ne répond pas. Les dernières données datées restent consultables."],
];

/** Traduit une erreur (Supabase/PostgreSQL ou applicative) en message français court, sans détail technique. */
export function traduireErreur(e: unknown): string {
  const brut = e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: string })?.message ?? "";
  for (const [motif, texte] of TRADUCTIONS) if (motif.test(brut)) return texte;
  return "Opération impossible pour le moment. Réessayez ; si le problème persiste, prévenez l'administrateur.";
}

/** Lève si Supabase renvoie une erreur : une panne ne doit jamais s'afficher comme un écran vide rassurant. */
export function lire<T>(resultat: { data: T | null; error: { message: string } | null }, contexte?: string): T {
  if (resultat.error) throw new ErreurApplicative("base", `${contexte ? contexte + " : " : ""}${resultat.error.message}`);
  return resultat.data as T;
}

/** Ne garde qu'un code court dans l'URL (jamais error.message brut). */
export function codeErreur(e: unknown): string {
  return encodeURIComponent(traduireErreur(e).slice(0, 200));
}
