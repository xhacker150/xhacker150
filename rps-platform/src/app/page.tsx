import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

/** Modules du socle (phase en cours). Voir CLAUDE.md §10. */
const modules = [
  {
    titre: "Import GESCOM",
    desc: "Consolidation des prises (ventes) selon les 18 contrôles. Lecture seule sur la source.",
    etat: "À venir — étape 3",
  },
  {
    titre: "Dashboard réseau",
    desc: "KPI volume / CA, par station, produit et client. Graphiques et filtres.",
    etat: "À venir — étape 4",
  },
  {
    titre: "Règlements & créances",
    desc: "Saisie des règlements, lettrage facture↔règlement, encours par ancienneté.",
    etat: "À venir — étape 5",
  },
] as const;

const charte = [
  { nom: "Rouge RPS", code: "#E30613", classe: "bg-rps-rouge" },
  { nom: "Bleu RPS", code: "#0150DA", classe: "bg-rps-bleu" },
  { nom: "Encre", code: "#1B2330", classe: "bg-rps-encre" },
  { nom: "Vert", code: "#1D8A4E", classe: "bg-rps-vert" },
  { nom: "Ambre", code: "#E08A00", classe: "bg-rps-ambre" },
] as const;

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <section className="mb-10">
          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-rps-mut">
            Phase SOCLE · Étape 1 — socle technique en place
          </span>
          <h1 className="mt-4 max-w-2xl font-heading text-3xl font-extrabold leading-tight">
            Plateforme de pilotage du réseau de stations-service RPS
          </h1>
          <p className="mt-3 max-w-2xl text-base text-rps-mut">
            Consolidation des ventes GESCOM, facturation clients, suivi des
            règlements et des créances — Next.js + Supabase, dans l&apos;esprit
            d&apos;un major pétrolier avec la rigueur d&apos;un ERP.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button>Tableau de bord</Button>
            <Button variant="outline">Documentation du socle</Button>
          </div>
        </section>

        <section className="mb-10 grid gap-4 sm:grid-cols-3">
          {modules.map((m) => (
            <article
              key={m.titre}
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <h2 className="font-heading text-base font-bold text-rps-bleu">
                {m.titre}
              </h2>
              <p className="mt-2 text-sm text-rps-mut">{m.desc}</p>
              <p className="mt-4 text-xs font-semibold text-rps-ambre">
                {m.etat}
              </p>
            </article>
          ))}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading text-base font-bold">Charte graphique</h2>
          <div className="mt-4 flex flex-wrap gap-4">
            {charte.map((c) => (
              <div key={c.nom} className="flex items-center gap-2">
                <span
                  className={`h-8 w-8 rounded-md ${c.classe} border border-black/5`}
                />
                <span className="text-xs">
                  <span className="block font-semibold">{c.nom}</span>
                  <span className="text-rps-mut">{c.code}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-rps-mut">
            Titres : Montserrat · Texte : Inter · Règle d&apos;or : les montants,
            quantités, dates et références GESCOM ne sont jamais modifiés.
          </p>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-6 py-4 text-xs text-rps-mut">
          RPS — Rissa Petroleum Service · {new Date().getFullYear()}
        </div>
      </footer>
    </>
  );
}
