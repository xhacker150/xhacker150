/**
 * Lecture complète par pages de 1 000 lignes : PostgREST plafonne chaque réponse (max-rows) SANS erreur.
 * Règle « aucun chiffre inventé » : un détail tronqué en silence est un chiffre faux.
 */
interface RequetePaginable {
  range(debut: number, fin: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function tout<T>(requete: RequetePaginable, taille = 1000, maximum = 200000): Promise<T[]> {
  const out: T[] = [];
  for (let debut = 0; debut < maximum; debut += taille) {
    const { data, error } = await requete.range(debut, debut + taille - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < taille) break;
  }
  return out;
}
