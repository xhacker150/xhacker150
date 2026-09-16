-- ============================================================
-- Compte SQL du pont : LECTURE SEULE garantie par les droits de base (pas seulement par le code).
-- À exécuter UNE FOIS par l'administrateur SQL Server sur RPS-SERVER\SAGE100 (règle n°5 de CLAUDE.md).
-- Préférer un compte de service Windows dédié (DOMAINE\svc_rps_pont) : remplacer les CREATE LOGIN/USER ci-dessous.
-- Jamais sysadmin, jamais db_owner. La tâche planifiée du pont s'exécute SOUS ce compte.
-- ============================================================
USE [master];
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'rps_pont')
    CREATE LOGIN [rps_pont] WITH PASSWORD = N'<mot de passe long, conservé dans le coffre>', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
GO

USE [RPS BD 26];   -- comptabilité
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rps_pont') CREATE USER [rps_pont] FOR LOGIN [rps_pont];
ALTER ROLE db_datareader ADD MEMBER [rps_pont];
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, CONTROL ON SCHEMA::dbo TO [rps_pont];
DENY CREATE TABLE, CREATE PROCEDURE, CREATE VIEW, CREATE FUNCTION TO [rps_pont];
GO

USE [RPS NOUV BD];   -- gestion commerciale
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rps_pont') CREATE USER [rps_pont] FOR LOGIN [rps_pont];
ALTER ROLE db_datareader ADD MEMBER [rps_pont];
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, CONTROL ON SCHEMA::dbo TO [rps_pont];
DENY CREATE TABLE, CREATE PROCEDURE, CREATE VIEW, CREATE FUNCTION TO [rps_pont];
GO

-- Trace des accès (cas de recette n°4 : « tentative d'écriture = échec par droits, tracé ») : SQL Server Audit
USE [master];
IF NOT EXISTS (SELECT 1 FROM sys.server_audits WHERE name = 'Audit_RPS_Pont')
BEGIN
    CREATE SERVER AUDIT [Audit_RPS_Pont] TO FILE (FILEPATH = N'D:\Audit\', MAXSIZE = 100 MB, MAX_ROLLOVER_FILES = 10) WITH (ON_FAILURE = CONTINUE);
    ALTER SERVER AUDIT [Audit_RPS_Pont] WITH (STATE = ON);
END
GO
USE [RPS BD 26];
IF NOT EXISTS (SELECT 1 FROM sys.database_audit_specifications WHERE name = 'Audit_RPS_Pont_Compta')
BEGIN
    CREATE DATABASE AUDIT SPECIFICATION [Audit_RPS_Pont_Compta] FOR SERVER AUDIT [Audit_RPS_Pont]
        ADD (INSERT, UPDATE, DELETE, EXECUTE ON DATABASE::[RPS BD 26] BY [rps_pont]) WITH (STATE = ON);
END
GO
USE [RPS NOUV BD];
IF NOT EXISTS (SELECT 1 FROM sys.database_audit_specifications WHERE name = 'Audit_RPS_Pont_Gescom')
BEGIN
    CREATE DATABASE AUDIT SPECIFICATION [Audit_RPS_Pont_Gescom] FOR SERVER AUDIT [Audit_RPS_Pont]
        ADD (INSERT, UPDATE, DELETE, EXECUTE ON DATABASE::[RPS NOUV BD] BY [rps_pont]) WITH (STATE = ON);
END
GO

-- Vérification (à rejouer en recette, connecté en rps_pont) : doit ÉCHOUER avec l'erreur 229 « permission refusée »
-- INSERT INTO [RPS BD 26].dbo.F_ECRITUREC DEFAULT VALUES;
