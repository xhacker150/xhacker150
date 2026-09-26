import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, fmtF, fmtM, formatDate, jours, lienWhatsApp, libelleMois } from "../src/lib/format.ts";
import { lireTsv, lots, genererCsv } from "../src/lib/tsv.ts";

test("montants au format 1 234 567", () => {
  assert.equal(fmt(1234567), "1 234 567");
  assert.equal(fmt(-47950), "-47 950");
  assert.equal(fmtF("282509928.4"), "282 509 928 F");
  assert.equal(fmtM(2_240_000_000), "2,24 Md");
  assert.equal(fmtM(101_476_896), "101,5 M");
});

test("dates et écarts", () => {
  assert.equal(formatDate("2026-09-16"), "16/09/2026");
  assert.equal(formatDate("2026-09-16", true), "16/09/26");
  assert.equal(formatDate(null), "—");
  assert.equal(jours("2026-08-01", "2026-09-16"), 46);
  assert.equal(libelleMois("2026-07"), "juil. 2026");
});

test("lien WhatsApp Niger", () => {
  assert.equal(lienWhatsApp("96 00 00 05", "Bonjour"), "https://wa.me/22796000005?text=Bonjour");
  assert.equal(lienWhatsApp("+227 90 00 00 01", "a b"), "https://wa.me/22790000001?text=a%20b");
  assert.equal(lienWhatsApp(null, "x"), null);
});

test("TSV du pont", () => {
  const rows = lireTsv("﻿CT_Num\tCT_Intitule\r\n41110001\tTRANSPORT X \r\n\r\n41110002\tCARGO\n");
  assert.deepEqual(rows, [["41110001", "TRANSPORT X"], ["41110002", "CARGO"]]);
  assert.deepEqual(lots([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.ok(genererCsv(["a"], [["x;y"]]).endsWith('"x;y"'));
});
