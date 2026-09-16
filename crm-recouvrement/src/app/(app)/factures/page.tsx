import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, formatDate, LIBELLES_STATUT_FACTURE } from "@/lib/format";
import { BadgeStatutFacture } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import type { VueFacture } from "@/lib/types";

export default async function PageFactures({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statut?: string; client_id?: string; retard?: string; succes?: string; erreur?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const parametres = await lireParametres();
  const devise = parametres.facturation.devise;
  const taille = 50;
  const page = Math.max(1, Number(sp.page ?? 1));

  let requete = supabase.from("vue_factures").select("*", { count: "exact" }).order("date_facture", { ascending: false }).order("numero", { ascending: false });
  if (sp.q) requete = requete.or(`numero.ilike.%${sp.q}%,client_nom.ilike.%${sp.q}%,reference_externe.ilike.%${sp.q}%,objet.ilike.%${sp.q}%`);
  if (sp.statut === "ouverte") requete = requete.in("statut", ["emise", "partiellement_payee"]);
  else if (sp.statut) requete = requete.eq("statut", sp.statut);
  if (sp.client_id) requete = requete.eq("client_id", sp.client_id);
  if (sp.retard) requete = requete.eq("en_retard", true);
  requete = requete.range((page - 1) * taille, page * taille - 1);
  const { data, count } = await requete;
  const factures = (data ?? []) as VueFacture[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / taille));

  const lienPage = (p: number) => {
    const u = new URLSearchParams();
    Object.entries(sp).forEach(([k, v]) => { if (v && k !== "page" && k !== "succes" && k !== "erreur") u.set(k, v); });
    u.set("page", String(p));
    return `/factures?${u.toString()}`;
  };

  return (
    <>
      <div className="entete">
        <div>
          <h1>Factures</h1>
          <p>{count ?? 0} facture(s)</p>
        </div>
        <div className="actions">
          <Link href="/import" className="btn">Importer depuis Sage</Link>
          <Link href="/factures/nouvelle" className="btn primary">+ Nouvelle facture</Link>
        </div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="carte">
        <form className="filtres" method="get">
          {sp.client_id && <input type="hidden" name="client_id" value={sp.client_id} />}
          <div className="champ"><label>Recherche</label><input name="q" defaultValue={sp.q ?? ""} placeholder="N°, client, référence" /></div>
          <div className="champ">
            <label>Statut</label>
            <select name="statut" defaultValue={sp.statut ?? ""}>
              <option value="">Tous</option>
              <option value="ouverte">Ouvertes (à encaisser)</option>
              {Object.entries(LIBELLES_STATUT_FACTURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <label className="champ inline"><input type="checkbox" name="retard" value="1" defaultChecked={Boolean(sp.retard)} /> En retard uniquement</label>
          <button className="btn" type="submit">Filtrer</button>
          {(sp.q || sp.statut || sp.retard || sp.client_id) && <Link href="/factures" className="btn lien">Réinitialiser</Link>}
        </form>
        <div className="tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Client</th><th>Date</th><th>Échéance</th><th>Objet</th><th className="num">TTC</th><th className="num">Reste</th><th>Statut</th><th className="num">Relance</th></tr></thead>
            <tbody>
              {factures.length === 0 && <tr><td colSpan={9} className="vide">Aucune facture.</td></tr>}
              {factures.map((f) => (
                <tr key={f.id}>
                  <td><Link href={`/factures/${f.id}`}>{f.numero}</Link>{f.reference_externe && <div className="texte-3 petit">{f.reference_externe}</div>}</td>
                  <td><Link href={`/clients/${f.client_id}`}>{f.client_nom}</Link></td>
                  <td>{formatDate(f.date_facture)}</td>
                  <td>{formatDate(f.date_echeance)}{f.en_retard && <div className="petit" style={{ color: "var(--danger)" }}>+{f.jours_retard} j</div>}</td>
                  <td>{f.objet}</td>
                  <td className="num">{formatMontant(f.montant_ttc, devise)}</td>
                  <td className="num">{["emise", "partiellement_payee"].includes(f.statut) ? formatMontant(f.reste_a_payer, devise) : "-"}</td>
                  <td><BadgeStatutFacture statut={f.statut} enRetard={f.en_retard} />{f.litige && <> <span className="badge warning">Litige</span></>}</td>
                  <td className="num">{f.niveau_relance > 0 ? `N${f.niveau_relance}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="mt" style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {page > 1 && <Link className="btn petit" href={lienPage(page - 1)}>← Précédent</Link>}
            <span className="petit texte-2" style={{ alignSelf: "center" }}>Page {page} / {totalPages}</span>
            {page < totalPages && <Link className="btn petit" href={lienPage(page + 1)}>Suivant →</Link>}
          </div>
        )}
      </div>
    </>
  );
}
