"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { enregistrerReglement, type EtatReglement } from "@/app/(app)/reglements/actions";
import { createClient } from "@/lib/supabase/client";
import { formatMontant, formatDate, LIBELLES_MODE_REGLEMENT } from "@/lib/format";

interface ClientOption { id: string; code: string; raison_sociale: string }
interface FactureOuverte { id: string; numero: string; date_echeance: string; montant_ttc: number; reste_a_payer: number; jours_retard: number; objet: string | null }

export function ReglementForm({ clients, clientInitial, factureInitiale, devise, dateDuJour }: { clients: ClientOption[]; clientInitial?: string; factureInitiale?: string; devise: string; dateDuJour: string }) {
  const [etat, action, enCours] = useActionState<EtatReglement, FormData>(enregistrerReglement, {});
  const [clientId, setClientId] = useState(clientInitial ?? "");
  const [montant, setMontant] = useState<number>(0);
  const [modeLettrage, setModeLettrage] = useState<"auto" | "manuel">(factureInitiale ? "manuel" : "auto");
  const [factures, setFactures] = useState<FactureOuverte[]>([]);
  const [affectations, setAffectations] = useState<Record<string, number>>({});
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    if (!clientId) { setFactures([]); return; }
    const supabase = createClient();
    setChargement(true);
    supabase
      .from("vue_factures")
      .select("id, numero, date_echeance, montant_ttc, reste_a_payer, jours_retard, objet")
      .eq("client_id", clientId)
      .in("statut", ["emise", "partiellement_payee"])
      .order("date_echeance")
      .then(({ data }) => {
        const liste = (data ?? []) as FactureOuverte[];
        setFactures(liste);
        setChargement(false);
        if (factureInitiale) {
          const f = liste.find((x) => x.id === factureInitiale);
          if (f) {
            setAffectations({ [f.id]: Number(f.reste_a_payer) });
            setMontant((m) => (m > 0 ? m : Number(f.reste_a_payer)));
          }
        }
      });
  }, [clientId, factureInitiale]);

  const totalAffecte = useMemo(() => Object.values(affectations).reduce((s, v) => s + (Number(v) || 0), 0), [affectations]);
  const totalOuvert = factures.reduce((s, f) => s + Number(f.reste_a_payer), 0);
  const lettrages = Object.entries(affectations).filter(([, v]) => v > 0).map(([facture_id, montant]) => ({ facture_id, montant }));

  const apercuAuto = useMemo(() => {
    let reste = montant;
    return factures.map((f) => {
      const aff = Math.max(0, Math.min(Number(f.reste_a_payer), reste));
      reste -= aff;
      return { id: f.id, aff };
    });
  }, [factures, montant]);

  return (
    <form action={action} className="form">
      {etat.erreur && <div className="alerte erreur">{etat.erreur}</div>}
      <input type="hidden" name="lettrages" value={JSON.stringify(lettrages)} />
      <input type="hidden" name="mode_lettrage" value={modeLettrage} />
      <div className="ligne ligne-3">
        <div className="champ" style={{ gridColumn: "span 2" }}>
          <label>Client *</label>
          <select name="client_id" required value={clientId} onChange={(e) => { setClientId(e.target.value); setAffectations({}); }}>
            <option value="">— Sélectionner —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.raison_sociale}</option>)}
          </select>
        </div>
        <div className="champ">
          <label>Montant reçu *</label>
          <input name="montant" type="number" min="1" step="1" required value={montant || ""} onChange={(e) => setMontant(Number(e.target.value))} />
        </div>
      </div>
      <div className="ligne ligne-4">
        <div className="champ"><label>Date *</label><input name="date_reglement" type="date" required defaultValue={dateDuJour} /></div>
        <div className="champ">
          <label>Mode</label>
          <select name="mode" defaultValue="virement">{Object.entries(LIBELLES_MODE_REGLEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <div className="champ"><label>Référence (n° chèque, virement...)</label><input name="reference" /></div>
        <div className="champ"><label>Banque</label><input name="banque" /></div>
      </div>

      <div className="carte" style={{ marginBottom: 0 }}>
        <h2>Affectation aux factures <small>{chargement ? "chargement..." : `${factures.length} facture(s) ouverte(s) · reste dû ${formatMontant(totalOuvert, devise)}`}</small></h2>
        <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
          <label className="champ inline"><input type="radio" checked={modeLettrage === "auto"} onChange={() => setModeLettrage("auto")} /> Automatique (les plus anciennes d&apos;abord)</label>
          <label className="champ inline"><input type="radio" checked={modeLettrage === "manuel"} onChange={() => setModeLettrage("manuel")} /> Manuelle</label>
        </div>
        <table className="tableau">
          <thead><tr><th>Facture</th><th>Échéance</th><th className="num">Reste dû</th><th className="num">{modeLettrage === "auto" ? "Sera affecté" : "Montant affecté"}</th></tr></thead>
          <tbody>
            {factures.length === 0 && <tr><td colSpan={4} className="vide">{clientId ? "Aucune facture ouverte : le règlement sera enregistré comme non affecté (avance)." : "Sélectionnez un client."}</td></tr>}
            {factures.map((f) => (
              <tr key={f.id}>
                <td>{f.numero}{f.objet && <div className="texte-3 petit">{f.objet}</div>}</td>
                <td>{formatDate(f.date_echeance)}{f.jours_retard > 0 && <span className="petit" style={{ color: "var(--danger)" }}> (+{f.jours_retard} j)</span>}</td>
                <td className="num">{formatMontant(f.reste_a_payer, devise)}</td>
                <td className="num">
                  {modeLettrage === "auto" ? (
                    formatMontant(apercuAuto.find((a) => a.id === f.id)?.aff ?? 0, devise)
                  ) : (
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <input type="number" min="0" max={Number(f.reste_a_payer)} step="1" style={{ width: 130, padding: 5, border: "1px solid var(--border)", borderRadius: 6, textAlign: "right" }}
                        value={affectations[f.id] ?? ""} onChange={(e) => setAffectations((p) => ({ ...p, [f.id]: Number(e.target.value) }))} />
                      <button type="button" className="btn petit" onClick={() => setAffectations((p) => ({ ...p, [f.id]: Number(f.reste_a_payer) }))}>Solder</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {modeLettrage === "manuel" && factures.length > 0 && (
            <tfoot><tr><td colSpan={3}>Total affecté</td><td className="num" style={{ color: totalAffecte > montant ? "var(--danger)" : undefined }}>{formatMontant(totalAffecte, devise)} / {formatMontant(montant, devise)}</td></tr></tfoot>
          )}
        </table>
      </div>
      <div className="champ"><label>Notes</label><textarea name="notes" rows={2} /></div>
      <div className="pied">
        <a href="/reglements" className="btn">Annuler</a>
        <button type="submit" className="btn primary" disabled={enCours}>{enCours ? "Enregistrement..." : "Enregistrer l'encaissement"}</button>
      </div>
    </form>
  );
}
