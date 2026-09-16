import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, formatDate, formatNombre } from "@/lib/format";
import type { VueFacture, LigneFacture } from "@/lib/types";

/** Vue imprimable de la facture (Ctrl+P / enregistrer en PDF). */
export default async function PageImprimerFacture({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: facture }, { data: lignes }, parametres] = await Promise.all([
    supabase.from("vue_factures").select("*").eq("id", id).single(),
    supabase.from("lignes_facture").select("*").eq("facture_id", id).order("ordre"),
    lireParametres(),
  ]);
  if (!facture) notFound();
  const f = facture as VueFacture;
  const { data: client } = await supabase.from("clients").select("*").eq("id", f.client_id).single();
  const devise = parametres.facturation.devise;
  const s = parametres.societe;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 32, background: "#fff", color: "#000", fontSize: 13 }}>
      <div className="non-imprimable" style={{ marginBottom: 16 }}>
        <a href={`/factures/${id}`} className="btn">← Retour</a> <button className="btn primary" type="button" id="imprimer">Imprimer</button>
        <script dangerouslySetInnerHTML={{ __html: "document.getElementById('imprimer').addEventListener('click',()=>window.print())" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{s.nom}</div>
          <div>{s.adresse}</div>
          <div>{[s.ville, s.pays].filter(Boolean).join(", ")}</div>
          <div>{s.telephone} {s.email}</div>
          <div>{s.nif ? `NIF : ${s.nif}` : ""} {s.rccm ? `RCCM : ${s.rccm}` : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>FACTURE</div>
          <div style={{ fontSize: 16 }}>{f.numero}</div>
          <div>Date : {formatDate(f.date_facture)}</div>
          <div>Échéance : {formatDate(f.date_echeance)}</div>
          {f.reference_externe && <div>Réf. : {f.reference_externe}</div>}
        </div>
      </div>
      <div style={{ border: "1px solid #ddd", padding: 12, marginBottom: 24, width: "50%", marginLeft: "auto" }}>
        <div style={{ fontWeight: 700 }}>{client?.raison_sociale}</div>
        <div>{client?.adresse}</div>
        <div>{[client?.ville, client?.pays].filter(Boolean).join(", ")}</div>
        <div>{client?.nif ? `NIF : ${client.nif}` : ""} {client?.rccm ? `RCCM : ${client.rccm}` : ""}</div>
        <div style={{ color: "#555", fontSize: 12 }}>Code client : {client?.code}</div>
      </div>
      {f.objet && <p><strong>Objet :</strong> {f.objet}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ textAlign: "left", padding: 8, border: "1px solid #ddd" }}>Désignation</th>
            <th style={{ textAlign: "right", padding: 8, border: "1px solid #ddd" }}>Qté</th>
            <th style={{ textAlign: "right", padding: 8, border: "1px solid #ddd" }}>PU HT</th>
            <th style={{ textAlign: "right", padding: 8, border: "1px solid #ddd" }}>TVA</th>
            <th style={{ textAlign: "right", padding: 8, border: "1px solid #ddd" }}>Total HT</th>
          </tr>
        </thead>
        <tbody>
          {((lignes ?? []) as LigneFacture[]).map((l) => (
            <tr key={l.id}>
              <td style={{ padding: 8, border: "1px solid #ddd" }}>{l.designation}</td>
              <td style={{ padding: 8, border: "1px solid #ddd", textAlign: "right" }}>{formatNombre(l.quantite, Number(l.quantite) % 1 ? 3 : 0)}</td>
              <td style={{ padding: 8, border: "1px solid #ddd", textAlign: "right" }}>{formatMontant(l.prix_unitaire, devise)}</td>
              <td style={{ padding: 8, border: "1px solid #ddd", textAlign: "right" }}>{formatNombre(l.taux_tva, 0)} %</td>
              <td style={{ padding: 8, border: "1px solid #ddd", textAlign: "right" }}>{formatMontant(l.montant_ht, devise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginLeft: "auto", borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={{ padding: "4px 16px" }}>Total HT</td><td style={{ padding: "4px 8px", textAlign: "right" }}>{formatMontant(f.montant_ht, devise)}</td></tr>
          <tr><td style={{ padding: "4px 16px" }}>TVA</td><td style={{ padding: "4px 8px", textAlign: "right" }}>{formatMontant(f.montant_tva, devise)}</td></tr>
          <tr style={{ fontWeight: 700, fontSize: 15 }}><td style={{ padding: "4px 16px", borderTop: "2px solid #000" }}>Total TTC</td><td style={{ padding: "4px 8px", textAlign: "right", borderTop: "2px solid #000" }}>{formatMontant(f.montant_ttc, devise)}</td></tr>
          {Number(f.montant_regle) > 0 && <>
            <tr><td style={{ padding: "4px 16px" }}>Déjà réglé</td><td style={{ padding: "4px 8px", textAlign: "right" }}>{formatMontant(f.montant_regle, devise)}</td></tr>
            <tr style={{ fontWeight: 700 }}><td style={{ padding: "4px 16px" }}>Reste à payer</td><td style={{ padding: "4px 8px", textAlign: "right" }}>{formatMontant(f.reste_a_payer, devise)}</td></tr>
          </>}
        </tbody>
      </table>
      <p style={{ marginTop: 32, fontSize: 11, color: "#555" }}>{parametres.facturation.mentions_legales}</p>
    </div>
  );
}
