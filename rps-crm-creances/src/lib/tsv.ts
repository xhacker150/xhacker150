/** Lecture des fichiers TSV produits par le pont (sql_out/qr*.txt) : 1 ligne d'en-tête, tabulations. */
export function lireTsv(contenu: string): string[][] {
  const texte = contenu.replace(/^﻿/, "");
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lignes.slice(1).map((l) => l.split("\t").map((v) => v.trim()));
}

/** Découpe un tableau en lots (pour rester sous la limite de taille des requêtes). */
export function lots<T>(tableau: T[], taille: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < tableau.length; i += taille) out.push(tableau.slice(i, i + taille));
  return out;
}

export function genererCsv(entetes: string[], lignes: (string | number | null | undefined)[][], sep = ";"): string {
  const echapper = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [entetes, ...lignes].map((l) => l.map(echapper).join(sep)).join("\r\n");
}
