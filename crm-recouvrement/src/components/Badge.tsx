import {
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_CLIENT,
  LIBELLES_STATUT_ACTION,
  LIBELLES_STATUT_PROMESSE,
} from "@/lib/format";

type Ton = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export function Badge({ ton = "neutral", children }: { ton?: Ton; children: React.ReactNode }) {
  return <span className={`badge ${ton}`}>{children}</span>;
}

export function BadgeStatutFacture({ statut, enRetard }: { statut: string; enRetard?: boolean }) {
  if (enRetard && (statut === "emise" || statut === "partiellement_payee")) {
    return <Badge ton="danger">{statut === "partiellement_payee" ? "Partielle · en retard" : "En retard"}</Badge>;
  }
  const tons: Record<string, Ton> = {
    brouillon: "neutral",
    emise: "primary",
    partiellement_payee: "warning",
    payee: "success",
    annulee: "neutral",
  };
  return <Badge ton={tons[statut] ?? "neutral"}>{LIBELLES_STATUT_FACTURE[statut] ?? statut}</Badge>;
}

export function BadgeStatutClient({ statut }: { statut: string }) {
  const tons: Record<string, Ton> = { actif: "success", surveille: "warning", bloque: "danger", contentieux: "danger", inactif: "neutral" };
  return <Badge ton={tons[statut] ?? "neutral"}>{LIBELLES_STATUT_CLIENT[statut] ?? statut}</Badge>;
}

export function BadgeStatutAction({ statut }: { statut: string }) {
  const tons: Record<string, Ton> = { planifiee: "warning", effectuee: "success", annulee: "neutral" };
  return <Badge ton={tons[statut] ?? "neutral"}>{LIBELLES_STATUT_ACTION[statut] ?? statut}</Badge>;
}

export function BadgeStatutPromesse({ statut }: { statut: string }) {
  const tons: Record<string, Ton> = { en_attente: "info", tenue: "success", rompue: "danger", annulee: "neutral" };
  return <Badge ton={tons[statut] ?? "neutral"}>{LIBELLES_STATUT_PROMESSE[statut] ?? statut}</Badge>;
}
