import { LIBELLES_STATUT, classeScore } from "@/lib/format";

export function Badge({ classe = "gris", children, title }: { classe?: string; children: React.ReactNode; title?: string }) {
  return <span className={`badge ${classe}`} title={title}>{children}</span>;
}
export function BadgeStatut({ statut, detail }: { statut: string; detail?: string }) {
  const s = LIBELLES_STATUT[statut] ?? { libelle: statut, classe: "gris" };
  return <span className={`badge ${s.classe}`}>{s.libelle}{detail ? ` ${detail}` : ""}</span>;
}
export function Score({ score }: { score: number }) {
  return <span title={`Score de risque ${score}/100`}><i className={`pastille ${classeScore(score)}`} />{score}</span>;
}
