'use strict';

/**
 * Service SMS - stub pour l'instant.
 *
 * Pour brancher un vrai fournisseur SMS (ex: Africa's Talking, Infobip, Orange SMS API Niger) :
 *   1. Installer le SDK correspondant (ex: `npm install africastalking`)
 *   2. Initialiser le client avec SMS_API_KEY et SMS_SENDER_ID
 *   3. Remplacer la logique ci-dessous par l'appel au SDK
 *
 * Exemple Africa's Talking:
 *   const AfricasTalking = require('africastalking');
 *   const at = AfricasTalking({ apiKey: process.env.SMS_API_KEY, username: 'votre_username' });
 *   const sms = at.SMS;
 *   await sms.send({ to: [to], message, from: process.env.SMS_SENDER_ID });
 */

/**
 * Envoie un SMS au numéro donné.
 * @param {string} to      - Numéro destinataire (ex: +22797000001)
 * @param {string} message - Contenu du SMS
 * @returns {Promise<void>}
 */
async function sendSms(to, message) {
  // STUB: en production, remplacer par l'appel au fournisseur SMS
  console.log(`[SMS STUB] To: ${to} | Message: ${message}`);
  // Retourne une promesse résolue pour ne pas bloquer le flux
  return Promise.resolve();
}

module.exports = { sendSms };
