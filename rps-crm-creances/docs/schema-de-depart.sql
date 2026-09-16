-- Base CRM RPS — schéma de départ (PostgreSQL). Sage reste la vérité des chiffres.
CREATE TABLE clients_ext (            -- extension du référentiel Sage (jamais les soldes !)
  compte        varchar(16) PRIMARY KEY,   -- = CT_Num Sage
  contacts      jsonb DEFAULT '[]',        -- [{nom, tel, whatsapp, role}]
  typologie     varchar(40),               -- CDC-05 §3.1 (auto, corrigeable)
  typologie_manuelle boolean DEFAULT false,
  limite_credit numeric(16,0),
  interlocuteur varchar(80),               -- chargé de compte
  segment_zone  varchar(40)
);
CREATE TABLE actions (                 -- relances, promesses, contentieux, notes
  id            bigserial PRIMARY KEY,
  compte        varchar(16) NOT NULL,
  type          varchar(20) NOT NULL CHECK (type IN ('relance','promesse','plan','contentieux','note')),
  statut        varchar(10) NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','fermee')),
  note          text,
  montant       numeric(16,0),             -- promesse / échéance de plan
  echeance      date,
  reglee_par_piece varchar(20),            -- pièce compta qui a soldé l'action
  auteur        varchar(80) NOT NULL,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  ferme_le      timestamptz
);
CREATE TABLE plans_paiement_echeances (
  id bigserial PRIMARY KEY, action_id bigint REFERENCES actions(id),
  echeance date NOT NULL, montant numeric(16,0) NOT NULL, tenue boolean
);
CREATE TABLE messages_sortants (       -- WhatsApp / SMS / e-mail
  id bigserial PRIMARY KEY, compte varchar(16) NOT NULL,
  canal varchar(10) NOT NULL, modele varchar(40), contenu text,
  envoye_par varchar(80), envoye_le timestamptz DEFAULT now()
);
CREATE TABLE etiquettes_payeur (       -- comptes collectifs (ex. SSN)
  id bigserial PRIMARY KEY, compte varchar(16) NOT NULL,
  piece varchar(20), payeur varchar(80)
);
CREATE TABLE reglements_liens (        -- particularités §3.3
  id bigserial PRIMARY KEY, compte varchar(16), piece varchar(20),
  lien varchar(20) CHECK (lien IN ('multi_clients','regle_via','regularise')),
  piece_liee varchar(20), compte_lie varchar(16), note text
);
CREATE TABLE audit (
  id bigserial PRIMARY KEY, quand timestamptz DEFAULT now(),
  qui varchar(80), quoi varchar(60), detail jsonb
);
CREATE INDEX ON actions(compte, statut); CREATE INDEX ON audit(quand);
