"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { analyserCsv, analyserMontant, analyserDate, choisirColonne } from "@/lib/csv";

const COL = {
  code: ["code", "compte", "compte_tiers", "n_compte", "numero_compte", "ct_num", "code_client", "tiers", "n_tiers"],
  nom: ["intitule", "raison_sociale", "nom", "client", "ct_intitule", "libelle_tiers", "designation"],
  nif: ["nif", "n_identification_fiscale", "ct_identifiant", "identifiant"],
  rccm: ["rccm", "siret", "ct_siret"],
  adresse: ["adresse", "ct_adresse"],
  ville: ["ville", "ct_ville"],
  pays: ["pays", "ct_pays"],
  telephone: ["telephone", "tel", "ct_telephone", "portable"],
  email: ["email", "e_mail", "mail", "ct_email", "courriel"],
  contact: ["contact", "ct_contact", "interlocuteur"],
  delai: ["delai_paiement", "delai", "condition_paiement", "echeance_jours", "nb_jours"],
  plafond: ["plafond_credit", "encours_max", "ct_encours", "plafond"],
  numero_piece: ["n_piece", "numero_piece", "piece", "do_piece", "numero", "n_facture", "facture", "numero_facture", "reference"],
  date: ["date", "date_piece", "do_date", "date_facture"],
  echeance: ["echeance", "date_echeance", "do_dateliv", "date_d_echeance"],
  ttc: ["montant_ttc", "ttc", "total_ttc", "do_totalttc", "montant", "solde", "debit"],
  ht: ["montant_ht", "ht", "total_ht", "do_totalht"],
  regle: ["regle", "montant_regle", "paye", "credit"],
  objet: ["objet", "libelle", "designation", "intitule_piece", "reference_document"],
};

async function lireFichier(formData: FormData): Promise<{ nom: string; contenu: string } | null> {
  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return null;
  const tampon = Buffer.from(await fichier.arrayBuffer());
  let contenu = tampon.toString("utf8");
  if (contenu.includes("�")) contenu = tampon.toString("latin1");
  return { nom: fichier.name, contenu };
}

export async function importerClients(formData: FormData) {
  const fichier = await lireFichier(formData);
  if (!fichier) redirect(`/import?erreur=${encodeURIComponent("Sélectionnez un fichier CSV")}`);
  const { lignes } = analyserCsv(fichier.contenu);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const erreurs: string[] = [];
  let importees = 0;
  let ignorees = 0;

  for (const [i, l] of lignes.entries()) {
    const code = choisirColonne(l, COL.code).toUpperCase();
    const nom = choisirColonne(l, COL.nom);
    if (!code || !nom) { erreurs.push(`Ligne ${i + 2} : code ou intitulé manquant`); ignorees++; continue; }
    const delai = Number(choisirColonne(l, COL.delai));
    const champs = {
      code: code.slice(0, 20),
      raison_sociale: nom.slice(0, 200),
      nif: choisirColonne(l, COL.nif) || null,
      rccm: choisirColonne(l, COL.rccm) || null,
      adresse: choisirColonne(l, COL.adresse) || null,
      ville: choisirColonne(l, COL.ville) || null,
      pays: choisirColonne(l, COL.pays) || null,
      telephone: choisirColonne(l, COL.telephone) || null,
      email: choisirColonne(l, COL.email) || null,
      contact_nom: choisirColonne(l, COL.contact) || null,
      delai_paiement_jours: Number.isFinite(delai) && delai > 0 ? delai : 30,
      plafond_credit: analyserMontant(choisirColonne(l, COL.plafond)) ?? 0,
      reference_sage: code,
    };
    const { error } = await supabase.from("clients").upsert(champs, { onConflict: "code" });
    if (error) { erreurs.push(`Ligne ${i + 2} (${code}) : ${error.message}`); ignorees++; } else importees++;
  }

  await supabase.from("imports_sage").insert({ type: "clients", nom_fichier: fichier.nom, nb_lignes: lignes.length, nb_importees: importees, nb_ignorees: ignorees, erreurs: erreurs.slice(0, 50), utilisateur_id: user?.id });
  revalidatePath("/clients");
  redirect(`/import?succes=${encodeURIComponent(`${importees} client(s) importé(s) ou mis à jour, ${ignorees} ignoré(s)`)}${erreurs.length ? `&erreur=${encodeURIComponent(erreurs.slice(0, 5).join(" | "))}` : ""}`);
}

export async function importerFactures(formData: FormData) {
  const fichier = await lireFichier(formData);
  if (!fichier) redirect(`/import?erreur=${encodeURIComponent("Sélectionnez un fichier CSV")}`);
  const creerClients = formData.get("creer_clients") === "1";
  const { lignes } = analyserCsv(fichier.contenu);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: clientsExistants } = await supabase.from("clients").select("id, code, reference_sage, delai_paiement_jours");
  const parCode = new Map<string, { id: string; delai: number }>();
  for (const c of clientsExistants ?? []) {
    parCode.set(c.code.toUpperCase(), { id: c.id, delai: c.delai_paiement_jours });
    if (c.reference_sage) parCode.set(c.reference_sage.toUpperCase(), { id: c.id, delai: c.delai_paiement_jours });
  }
  const { data: facturesExistantes } = await supabase.from("factures").select("reference_externe").not("reference_externe", "is", null);
  const refsExistantes = new Set((facturesExistantes ?? []).map((f) => f.reference_externe as string));

  const erreurs: string[] = [];
  let importees = 0;
  let ignorees = 0;

  for (const [i, l] of lignes.entries()) {
    const codeClient = choisirColonne(l, COL.code).toUpperCase();
    const piece = choisirColonne(l, COL.numero_piece);
    const dateFacture = analyserDate(choisirColonne(l, COL.date));
    const ttc = analyserMontant(choisirColonne(l, COL.ttc));
    const ht = analyserMontant(choisirColonne(l, COL.ht));
    const regle = analyserMontant(choisirColonne(l, COL.regle)) ?? 0;
    if (!codeClient || !piece || !dateFacture || ttc === null) { erreurs.push(`Ligne ${i + 2} : compte, n° pièce, date ou montant manquant`); ignorees++; continue; }
    if (ttc <= 0) { erreurs.push(`Ligne ${i + 2} (${piece}) : montant nul ou négatif (avoir non géré)`); ignorees++; continue; }
    if (refsExistantes.has(piece)) { ignorees++; continue; }

    let client = parCode.get(codeClient);
    if (!client) {
      if (!creerClients) { erreurs.push(`Ligne ${i + 2} : client ${codeClient} inconnu`); ignorees++; continue; }
      const nom = choisirColonne(l, COL.nom) || codeClient;
      const { data: nouveau, error } = await supabase.from("clients").insert({ code: codeClient.slice(0, 20), raison_sociale: nom.slice(0, 200), reference_sage: codeClient }).select("id, delai_paiement_jours").single();
      if (error || !nouveau) { erreurs.push(`Ligne ${i + 2} : création client ${codeClient} impossible (${error?.message})`); ignorees++; continue; }
      client = { id: nouveau.id, delai: nouveau.delai_paiement_jours };
      parCode.set(codeClient, client);
    }

    const echeance = analyserDate(choisirColonne(l, COL.echeance));
    // Montant HT fourni : on reconstitue la TVA ; sinon on considère le TTC hors taxe (import solde)
    const baseHt = ht !== null && ht > 0 && ht <= ttc ? ht : ttc;
    const taux = ht !== null && ht > 0 && ht < ttc ? Math.round(((ttc - ht) / ht) * 10000) / 100 : 0;
    const lignesFacture = [{ designation: choisirColonne(l, COL.objet) || `Import Sage ${piece}`, quantite: 1, prix_unitaire: baseHt, taux_tva: taux }];

    const { data: factureId, error } = await supabase.rpc("creer_facture", {
      p_client_id: client.id,
      p_lignes: lignesFacture,
      p_date_facture: dateFacture,
      p_date_echeance: echeance && echeance >= dateFacture ? echeance : null,
      p_objet: choisirColonne(l, COL.objet) || null,
      p_reference_externe: piece,
      p_notes: `Importé de Sage (${fichier.nom})`,
      p_emettre: true,
    });
    if (error) { erreurs.push(`Ligne ${i + 2} (${piece}) : ${error.message}`); ignorees++; continue; }
    refsExistantes.add(piece);
    importees++;

    if (regle > 0 && factureId) {
      const { error: errReg } = await supabase.rpc("enregistrer_reglement", {
        p_client_id: client.id,
        p_montant: Math.min(regle, ttc),
        p_date_reglement: dateFacture,
        p_mode: "autre",
        p_reference: `Solde Sage ${piece}`,
        p_notes: "Règlement repris de Sage à l'import",
        p_lettrages: [{ facture_id: factureId, montant: Math.min(regle, ttc) }],
      });
      if (errReg) erreurs.push(`Ligne ${i + 2} (${piece}) : règlement non repris (${errReg.message})`);
    }
  }

  await supabase.from("imports_sage").insert({ type: "factures", nom_fichier: fichier.nom, nb_lignes: lignes.length, nb_importees: importees, nb_ignorees: ignorees, erreurs: erreurs.slice(0, 50), utilisateur_id: user?.id });
  revalidatePath("/factures");
  revalidatePath("/clients");
  redirect(`/import?succes=${encodeURIComponent(`${importees} facture(s) importée(s), ${ignorees} ignorée(s) (doublons ou erreurs)`)}${erreurs.length ? `&erreur=${encodeURIComponent(erreurs.slice(0, 5).join(" | "))}` : ""}`);
}
