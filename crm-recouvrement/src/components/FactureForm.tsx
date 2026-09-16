"use client";

import { useActionState, useMemo, useState } from "react";
import { creerFacture, type EtatFacture } from "@/app/(app)/factures/actions";
import { formatMontant, ajouterJours } from "@/lib/format";

interface Ligne {
  designation: string;
  quantite: number;
  prix_unitaire: number;
  taux_tva: number;
}

interface ClientOption {
  id: string;
  code: string;
  raison_sociale: string;
  delai_paiement_jours: number;
  statut: string;
}

export function FactureForm({
  clients,
  clientInitial,
  tauxTvaDefaut,
  devise,
  dateDuJour,
}: {
  clients: ClientOption[];
  clientInitial?: string;
  tauxTvaDefaut: number;
  devise: string;
  dateDuJour: string;
}) {
  const [etat, action, enCours] = useActionState<EtatFacture, FormData>(creerFacture, {});
  const [clientId, setClientId] = useState(clientInitial ?? "");
  const [dateFacture, setDateFacture] = useState(dateDuJour);
  const [dateEcheance, setDateEcheance] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>([{ designation: "", quantite: 1, prix_unitaire: 0, taux_tva: tauxTvaDefaut }]);

  const client = clients.find((c) => c.id === clientId);
  const echeanceCalculee = client ? ajouterJours(dateFacture, client.delai_paiement_jours) : "";

  const totaux = useMemo(() => {
    let ht = 0;
    let tva = 0;
    for (const l of lignes) {
      const lht = Math.round(l.quantite * l.prix_unitaire * 100) / 100;
      ht += lht;
      tva += Math.round((lht * l.taux_tva) / 100 * 100) / 100;
    }
    return { ht, tva, ttc: ht + tva };
  }, [lignes]);

  const majLigne = (i: number, champ: keyof Ligne, valeur: string) => {
    setLignes((prev) => prev.map((l, j) => (j === i ? { ...l, [champ]: champ === "designation" ? valeur : Number(valeur) } : l)));
  };

  return (
    <form action={action} className="form">
      {etat.erreur && <div className="alerte erreur">{etat.erreur}</div>}
      <input type="hidden" name="lignes" value={JSON.stringify(lignes)} />
      <div className="ligne ligne-3">
        <div className="champ" style={{ gridColumn: "span 2" }}>
          <label>Client *</label>
          <select name="client_id" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.code} · {c.raison_sociale}{c.statut === "bloque" ? " (BLOQUÉ)" : c.statut === "contentieux" ? " (CONTENTIEUX)" : ""}</option>
            ))}
          </select>
          {client && (client.statut === "bloque" || client.statut === "contentieux") && (
            <span className="aide" style={{ color: "var(--danger)" }}>Attention : ce client est {client.statut === "bloque" ? "bloqué" : "en contentieux"}.</span>
          )}
        </div>
        <div className="champ">
          <label>Référence externe (n° Sage)</label>
          <input name="reference_externe" placeholder="FA-2026-..." />
        </div>
      </div>
      <div className="ligne ligne-3">
        <div className="champ">
          <label>Date de facture *</label>
          <input name="date_facture" type="date" required value={dateFacture} onChange={(e) => setDateFacture(e.target.value)} />
        </div>
        <div className="champ">
          <label>Échéance</label>
          <input name="date_echeance" type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} placeholder={echeanceCalculee} />
          <span className="aide">Vide = date + délai client ({client ? `${client.delai_paiement_jours} j → ${echeanceCalculee.split("-").reverse().join("/")}` : "-"})</span>
        </div>
        <div className="champ">
          <label>Objet</label>
          <input name="objet" placeholder="Livraison, prestation..." />
        </div>
      </div>

      <div className="tableau-conteneur">
        <table className="tableau">
          <thead>
            <tr><th style={{ width: "45%" }}>Désignation</th><th className="num">Quantité</th><th className="num">Prix unitaire HT</th><th className="num">TVA %</th><th className="num">Total HT</th><th></th></tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}>
                <td><input className="champ-inline" style={{ width: "100%", padding: 6, border: "1px solid var(--border)", borderRadius: 6 }} value={l.designation} onChange={(e) => majLigne(i, "designation", e.target.value)} placeholder="Désignation" /></td>
                <td className="num"><input type="number" step="0.001" min="0" style={{ width: 90, padding: 6, border: "1px solid var(--border)", borderRadius: 6, textAlign: "right" }} value={l.quantite} onChange={(e) => majLigne(i, "quantite", e.target.value)} /></td>
                <td className="num"><input type="number" step="1" min="0" style={{ width: 130, padding: 6, border: "1px solid var(--border)", borderRadius: 6, textAlign: "right" }} value={l.prix_unitaire} onChange={(e) => majLigne(i, "prix_unitaire", e.target.value)} /></td>
                <td className="num"><input type="number" step="0.01" min="0" style={{ width: 70, padding: 6, border: "1px solid var(--border)", borderRadius: 6, textAlign: "right" }} value={l.taux_tva} onChange={(e) => majLigne(i, "taux_tva", e.target.value)} /></td>
                <td className="num">{formatMontant(l.quantite * l.prix_unitaire, devise)}</td>
                <td className="actions">
                  <button type="button" className="btn petit" onClick={() => setLignes((p) => p.filter((_, j) => j !== i))} disabled={lignes.length === 1}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button type="button" className="btn petit" onClick={() => setLignes((p) => [...p, { designation: "", quantite: 1, prix_unitaire: 0, taux_tva: tauxTvaDefaut }])}>+ Ajouter une ligne</button>
      </div>
      <div className="total-ligne">
        <span>Total HT : <strong>{formatMontant(totaux.ht, devise)}</strong></span>
        <span>TVA : <strong>{formatMontant(totaux.tva, devise)}</strong></span>
        <span>Total TTC : <strong>{formatMontant(totaux.ttc, devise)}</strong></span>
      </div>
      <div className="champ">
        <label>Notes (internes)</label>
        <textarea name="notes" rows={2} />
      </div>
      <div className="pied">
        <a href="/factures" className="btn">Annuler</a>
        <button type="submit" name="emettre" value="0" className="btn" disabled={enCours}>Enregistrer en brouillon</button>
        <button type="submit" name="emettre" value="1" className="btn primary" disabled={enCours}>{enCours ? "Enregistrement..." : "Émettre la facture"}</button>
      </div>
    </form>
  );
}
