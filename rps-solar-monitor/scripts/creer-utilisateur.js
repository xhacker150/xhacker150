#!/usr/bin/env node
'use strict';

/**
 * Crée ou met à jour un utilisateur du tableau de bord.
 *   MOT_DE_PASSE='…' node scripts/creer-utilisateur.js <identifiant> <lecteur|operateur|admin> ["Nom complet"]
 * Le mot de passe est lu dans MOT_DE_PASSE pour ne pas apparaître dans l'historique du shell.
 */

const bcrypt = require('bcryptjs');
const { config } = require('../src/config');
const { creerPool, appliquerSchema } = require('../src/db/pool');

const ROLES = ['lecteur', 'operateur', 'admin'];

async function main() {
  const [identifiant, role, nom] = process.argv.slice(2);
  const motDePasse = process.env.MOT_DE_PASSE;
  if (!identifiant || !ROLES.includes(role)) {
    console.error(`Usage : MOT_DE_PASSE='…' node scripts/creer-utilisateur.js <identifiant> <${ROLES.join('|')}> ["Nom"]`);
    process.exit(1);
  }
  if (!motDePasse || motDePasse.length < 10) {
    console.error('MOT_DE_PASSE doit contenir au moins 10 caractères.');
    process.exit(1);
  }
  const pool = creerPool(config.db);
  try {
    await appliquerSchema(pool);
    const hash = await bcrypt.hash(motDePasse, 12);
    const { rows } = await pool.query(
      `INSERT INTO utilisateurs (identifiant, nom, mot_de_passe_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (identifiant) DO UPDATE
         SET nom = COALESCE(EXCLUDED.nom, utilisateurs.nom), mot_de_passe_hash = EXCLUDED.mot_de_passe_hash,
             role = EXCLUDED.role, actif = true
       RETURNING id, identifiant, role`,
      [identifiant, nom || null, hash, role]
    );
    console.log(`Utilisateur ${rows[0].identifiant} (${rows[0].role}) enregistré, id ${rows[0].id}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
