import { test } from "node:test";
import assert from "node:assert/strict";
import { analyserCsv, analyserMontant, analyserDate, normaliserEntete, genererCsv, decouperLigne } from "../src/lib/csv.ts";

test("analyserMontant gère les formats français et anglais", () => {
  assert.equal(analyserMontant("1 234,50"), 1234.5);
  assert.equal(analyserMontant("1.234,50"), 1234.5);
  assert.equal(analyserMontant("1,234.50"), 1234.5);
  assert.equal(analyserMontant("124950"), 124950);
  assert.equal(analyserMontant("124 950 XOF"), 124950);
  assert.equal(analyserMontant(""), null);
  assert.equal(analyserMontant("abc"), null);
});

test("analyserDate accepte jj/mm/aaaa, ISO et formats compacts Sage", () => {
  assert.equal(analyserDate("31/12/2025"), "2025-12-31");
  assert.equal(analyserDate("2025-12-31"), "2025-12-31");
  assert.equal(analyserDate("2025-12-31T10:00:00"), "2025-12-31");
  assert.equal(analyserDate("5/1/2026"), "2026-01-05");
  assert.equal(analyserDate("311225"), "2025-12-31");
  assert.equal(analyserDate("31122025"), "2025-12-31");
  assert.equal(analyserDate("n/a"), null);
});

test("normaliserEntete retire accents et ponctuation", () => {
  assert.equal(normaliserEntete("N° pièce"), "n_piece");
  assert.equal(normaliserEntete("Échéance"), "echeance");
  assert.equal(normaliserEntete("Montant TTC "), "montant_ttc");
});

test("analyserCsv détecte le séparateur et respecte les guillemets", () => {
  const csv = '﻿Compte;Intitulé;Montant TTC\r\nCL001;"SOCIETE; A";1 000,00\r\nCL002;"Dit ""Le Grand""";50\r\n';
  const { entetes, lignes } = analyserCsv(csv);
  assert.deepEqual(entetes, ["compte", "intitule", "montant_ttc"]);
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].intitule, "SOCIETE; A");
  assert.equal(lignes[1].intitule, 'Dit "Le Grand"');
  assert.equal(analyserMontant(lignes[0].montant_ttc), 1000);
});

test("decouperLigne avec virgule", () => {
  assert.deepEqual(decouperLigne('a,"b,c",d', ","), ["a", "b,c", "d"]);
});

test("genererCsv échappe les valeurs et ajoute le BOM", () => {
  const out = genererCsv(["code", "nom"], [["CL1", 'Société "X"; SA'], ["CL2", null]]);
  assert.ok(out.startsWith("﻿"));
  assert.ok(out.includes('CL1;"Société ""X""; SA"'));
  assert.ok(out.endsWith("CL2;"));
});
