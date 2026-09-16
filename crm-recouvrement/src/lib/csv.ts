/**
 * Lecture et écriture de fichiers CSV compatibles avec les exports Sage
 * (séparateur ";" ou ",", décimales à la virgule, dates jj/mm/aaaa, encodage UTF-8).
 */

export function detecterSeparateur(ligne: string): string {
  const candidats = [";", ",", "\t", "|"];
  let meilleur = ";";
  let max = -1;
  for (const c of candidats) {
    const n = ligne.split(c).length - 1;
    if (n > max) {
      max = n;
      meilleur = c;
    }
  }
  return meilleur;
}

/** Découpe une ligne CSV en respectant les guillemets. */
export function decouperLigne(ligne: string, sep: string): string[] {
  const champs: string[] = [];
  let courant = "";
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') {
        courant += '"';
        i++;
      } else {
        entreGuillemets = !entreGuillemets;
      }
    } else if (c === sep && !entreGuillemets) {
      champs.push(courant);
      courant = "";
    } else {
      courant += c;
    }
  }
  champs.push(courant);
  return champs.map((v) => v.trim());
}

/** Normalise un en-tête : minuscules, sans accents ni ponctuation. */
export function normaliserEntete(entete: string): string {
  return entete
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function analyserCsv(contenu: string): { entetes: string[]; lignes: Record<string, string>[] } {
  const texte = contenu.replace(/^﻿/, "");
  const brutes = texte.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (brutes.length === 0) return { entetes: [], lignes: [] };
  const sep = detecterSeparateur(brutes[0]);
  const entetes = decouperLigne(brutes[0], sep).map(normaliserEntete);
  const lignes = brutes.slice(1).map((l) => {
    const valeurs = decouperLigne(l, sep);
    const obj: Record<string, string> = {};
    entetes.forEach((e, i) => {
      obj[e] = valeurs[i] ?? "";
    });
    return obj;
  });
  return { entetes, lignes };
}

/** "1 234,50" | "1234.50" | "1.234,50" -> 1234.5 */
export function analyserMontant(valeur: string | undefined | null): number | null {
  if (valeur === undefined || valeur === null) return null;
  let s = String(valeur).replace(/\s| | /g, "").replace(/[A-Za-z]/g, "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) {
    // le dernier séparateur est le décimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "31/12/2025" | "2025-12-31" | "31-12-2025" | "311225" -> "2025-12-31" */
export function analyserDate(valeur: string | undefined | null): string | null {
  if (!valeur) return null;
  const s = String(valeur).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Première colonne présente parmi une liste d'alias. */
export function choisirColonne(ligne: Record<string, string>, alias: string[]): string {
  for (const a of alias) {
    const v = ligne[a];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

export function genererCsv(entetes: string[], lignes: (string | number | null | undefined)[][], sep = ";"): string {
  const echapper = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corps = [entetes, ...lignes].map((l) => l.map(echapper).join(sep)).join("\r\n");
  return "﻿" + corps;
}
