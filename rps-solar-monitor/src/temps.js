'use strict';

/**
 * Fuseaux horaires sous forme de décalage fixe en minutes (le Niger est en UTC+1
 * sans heure d'été, et fSolar renvoie des fuseaux du type "UTC+03:00").
 */

/** "UTC+03:00", "GMT+1", "+01:00", "UTC-5", "UTC" → décalage en minutes, ou null. */
function analyserFuseau(texte) {
  if (texte === undefined || texte === null) return null;
  const s = String(texte).trim().toUpperCase();
  if (s === 'UTC' || s === 'GMT' || s === 'Z') return 0;
  const m = s.match(/^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const heures = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  if (heures > 14 || minutes > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (heures * 60 + minutes);
}

/** "yyyy-MM-dd HH:mm:ss" (heure locale à décalage fixe) → Date, ou null. */
function dateDepuisTexteLocal(texte, decalageMinutes) {
  if (!texte) return null;
  const m = String(texte).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, a, mo, j, h = '0', mi = '0', se = '0'] = m;
  const utc = Date.UTC(+a, +mo - 1, +j, +h, +mi, +se) - decalageMinutes * 60000;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "YYYY-MM-DD" dans le fuseau donné. */
function jourLocal(date, decalageMinutes) {
  return new Date(date.getTime() + decalageMinutes * 60000).toISOString().slice(0, 10);
}

module.exports = { analyserFuseau, dateDepuisTexteLocal, jourLocal };
