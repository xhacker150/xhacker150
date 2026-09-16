import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMontant, formatDate, ajouterJours, formatNombre } from "../src/lib/format.ts";

test("formatMontant sépare les milliers et ajoute la devise", () => {
  assert.equal(formatMontant(124950), "124 950 XOF");
  assert.equal(formatMontant("1234567.89", "EUR"), "1 234 568 EUR");
  assert.equal(formatMontant(-5000), "-5 000 XOF");
  assert.equal(formatMontant(null), "0 XOF");
});

test("formatNombre avec décimales", () => {
  assert.equal(formatNombre(1234.5, 2), "1 234,50");
  assert.equal(formatNombre(19, 0), "19");
});

test("formatDate et ajouterJours", () => {
  assert.equal(formatDate("2026-09-16"), "16/09/2026");
  assert.equal(formatDate("2026-09-16T08:00:00+00:00"), "16/09/2026");
  assert.equal(formatDate(null), "");
  assert.equal(ajouterJours("2026-01-30", 5), "2026-02-04");
  assert.equal(ajouterJours("2026-12-31", 30), "2027-01-30");
});
