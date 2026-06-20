import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = req.headers.get("X-Api-Key");
  const expectedKey = Deno.env.get("SAGE_API_KEY");
  if (!expectedKey || apiKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized — fournissez X-Api-Key valide" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const url = new URL(req.url);
  // Extract sub-path after "sage-sync"
  const path = url.pathname.replace(/^.*sage-sync\/?/, "");

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = async (direction: string, entity: string, count: number, status: string, details?: string) => {
    await sb.from("sage_sync_log").insert({ direction, entity, count, status, details: details ?? null }).catch(() => {});
  };

  try {
    // GET /bons?station_id=&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
    if (req.method === "GET" && path.startsWith("bons")) {
      const station_id = url.searchParams.get("station_id");
      const date_from = url.searchParams.get("date_from");
      const date_to   = url.searchParams.get("date_to");

      let q = sb.from("bons").select("*,stations(name)");
      if (station_id) q = q.eq("station_id", station_id);
      if (date_from)  q = q.gte("created_at", date_from);
      if (date_to)    q = q.lte("created_at", date_to + "T23:59:59");

      const { data, error } = await q.order("created_at");
      if (error) throw error;

      const bons = (data ?? []).filter((b: any) => b.bl).map((b: any) => ({
        sage_piece:       b.bl,
        date:             `${String(b.d_day).padStart(2,"0")}/${String(b.d_month).padStart(2,"0")}/${b.d_year}`,
        compte_client:    b.cpt ?? "",
        nom_client:       b.nom ?? "",
        immatriculation:  b.immat ?? "",
        produit:          b.produit ?? "",
        quantite:         b.qte ?? 0,
        prix_unitaire:    b.pu ?? 0,
        montant_ht:       b.qte && b.pu ? Math.round(b.qte * b.pu) : 0,
        station:          (b as any).stations?.name ?? b.station_id,
        source_id:        b.id
      }));

      await log("export", "bons", bons.length, "ok");
      return new Response(JSON.stringify({ count: bons.length, bons }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /clients
    if (req.method === "GET" && path.startsWith("clients")) {
      const { data, error } = await sb.from("clients").select("*").order("nom");
      if (error) throw error;

      const clients = (data ?? []).map((c: any) => ({
        compte:           c.cpt,
        compte_principal: c.prin ?? "",
        nom:              c.nom ?? ""
      }));

      await log("export", "clients", clients.length, "ok");
      return new Response(JSON.stringify({ count: clients.length, clients }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // POST /ecritures  — réception d'écritures depuis Sage 100
    if (req.method === "POST" && path.startsWith("ecritures")) {
      const body = await req.json();
      const entries: any[] = Array.isArray(body) ? body : [body];

      const rows = entries.map((e: any) => ({
        station_id:   e.station_id ?? null,
        date:         e.date ?? null,
        compte:       e.compte ?? "",
        libelle:      e.libelle ?? "",
        debit:        e.debit ?? 0,
        credit:       e.credit ?? 0,
        source:       "sage100",
        ref_externe:  e.ref ?? null
      }));

      const { error } = await sb.from("ecritures").insert(rows);
      if (error) throw error;

      await log("import", "ecritures", rows.length, "ok");
      return new Response(JSON.stringify({ ok: true, imported: rows.length }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET / — ping / documentation
    if (req.method === "GET") {
      return new Response(JSON.stringify({
        service:   "ERP Stations — Sage 100 GESCOM Sync Gateway",
        version:   "1.0",
        auth:      "Header X-Api-Key: <SAGE_API_KEY>",
        endpoints: [
          "GET  /bons?station_id=<uuid>&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD",
          "GET  /clients",
          "POST /ecritures  [{ station_id, date, compte, libelle, debit, credit, ref }]"
        ]
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Route introuvable" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    await log("?", "?", 0, "error", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
