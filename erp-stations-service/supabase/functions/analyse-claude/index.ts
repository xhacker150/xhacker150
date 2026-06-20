// =====================================================================
//  Edge Function : analyse-claude
//  Claude analyse une station + mois pour : détecter les FRAUDES,
//  dégager les TENDANCES et produire des PRÉVISIONS.
//
//  Principe de fiabilité : la base PostgreSQL calcule les chiffres exacts
//  (fonction dossier_analyse) ; Claude RAISONNE dessus, il ne recalcule pas.
//  Les fraudes détectées sont ENREGISTRÉES dans la table "alertes".
//
//  Secret requis :  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//  Déploiement   :  supabase functions deploy analyse-claude
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-opus-4-8";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "CLE_ABSENTE", message: "Clé Anthropic non configurée (secret ANTHROPIC_API_KEY)." }, 503);
    }
    const { station_id, year, month, horizon_jours = 7 } = await req.json();
    if (!station_id || !year || !month) {
      return json({ error: "Paramètres requis : station_id, year, month" }, 400);
    }

    // Client portant le JWT de l'appelant => RLS appliquée.
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    // 1) DOSSIER EXACT calculé par PostgreSQL (chiffres fiables)
    const { data: dossier, error: e1 } = await supa.rpc("dossier_analyse", {
      p_station: station_id, p_year: year, p_month: month,
    });
    if (e1) throw e1;
    if (!dossier || !(dossier.jours?.length)) {
      return json({ synthese: "Aucune donnée à analyser sur la période.", fraudes: [], tendances: dossier?.tendances ?? [], previsions: {} });
    }

    // 2) Demander à Claude : fraudes + tendances + prévisions, en JSON strict
    const sys = [
      "Tu es analyste anti-fraude et prévisionniste pour un réseau de stations-service (comptabilité SYSCOHADA, devise XOF, carburant Super et Gasoil).",
      "On te fournit un DOSSIER déjà chiffré exactement par la base de données : ne recalcule pas, raisonne sur ces chiffres.",
      "Définitions : 'ecart' = versement du pompiste − recette cash théorique ; un écart négatif = manquant (cash non remis), positif = excédent.",
      "'reperes_ecart' donne la moyenne et l'écart-type historiques de la station pour juger ce qui est anormal.",
      "Tâches :",
      "1) FRAUDES : repère les journées ou bons suspects (manquants de caisse importants au regard des repères, bons gonflés par rapport au top clients, incohérences). Pour chacun : type, gravite (faible/moyenne/haute), score de confiance 0-100, message clair en français, et fiche_id concernée si disponible.",
      "2) TENDANCES : commente l'évolution de la consommation par produit à partir de 'tendances'.",
      "3) PRÉVISIONS : estime le besoin en litres par produit sur l'horizon fourni, à partir des moyennes/pentes.",
      "Sois prudent et factuel : ce sont des anomalies À VÉRIFIER, pas des fraudes prouvées. N'invente aucun chiffre.",
      "Réponds STRICTEMENT en JSON, sans texte autour, au format :",
      '{"synthese":"...","fraudes":[{"fiche_id":"...|null","type":"FRAUDE_CAISSE|BON_SUSPECT|COULAGE|AUTRE","gravite":"faible|moyenne|haute","score":0,"message":"...","detail":{}}],"tendances_txt":"...","previsions":{"Super":0,"Gasoil":0}}',
    ].join(" ");

    const userMsg =
      `Horizon de prévision : ${horizon_jours} jours.\n` +
      `DOSSIER (chiffres exacts) :\n` + JSON.stringify(dossier);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: sys,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: "ANTHROPIC", message: t }, 502);
    }
    const out = await resp.json();
    const text = (out.content ?? []).map((c: any) => (c.type === "text" ? c.text : "")).join("").trim();

    let parsed: any = {};
    try {
      const clean = text.replace(/```json|```/g, "").trim();
      const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
      parsed = JSON.parse(s >= 0 ? clean.slice(s, e + 1) : clean);
    } catch {
      parsed = { synthese: text || "Réponse non exploitable.", fraudes: [], tendances_txt: "", previsions: {} };
    }

    // 3) ENREGISTRER les fraudes détectées (on remplace les détections Claude non résolues de la période)
    const ficheIds = (dossier.jours ?? []).map((j: any) => j.fiche_id).filter(Boolean);
    if (ficheIds.length) {
      await supa.from("alertes").delete()
        .eq("station_id", station_id).eq("resolue", false).eq("source", "claude")
        .in("fiche_id", ficheIds);
    }
    const fraudes = Array.isArray(parsed.fraudes) ? parsed.fraudes : [];
    let inserted: any[] = [];
    if (fraudes.length) {
      const rows = fraudes.map((f: any) => ({
        station_id,
        fiche_id: f.fiche_id && f.fiche_id !== "null" ? f.fiche_id : null,
        type: String(f.type ?? "AUTRE").slice(0, 40),
        gravite: ["faible", "moyenne", "haute"].includes(f.gravite) ? f.gravite : "moyenne",
        score: Number(f.score ?? 0),
        message: String(f.message ?? ""),
        detail: f.detail ?? {},
        source: "claude",
      }));
      const { data: ins, error: e3 } = await supa.from("alertes").insert(rows).select();
      if (e3) {
        // si l'utilisateur n'a pas le droit d'écrire les alertes, on renvoie quand même l'analyse
        inserted = rows.map((r) => ({ ...r, _non_enregistre: true }));
      } else {
        inserted = ins ?? [];
      }
    }

    return json({
      synthese: parsed.synthese ?? "",
      fraudes: inserted,
      tendances_txt: parsed.tendances_txt ?? "",
      tendances: dossier.tendances ?? [],
      previsions: parsed.previsions ?? {},
      horizon_jours,
      modele: MODEL,
    });
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
