# Planification du pont sur RPS-SERVER

1. Créer le compte SQL lecture seule : `sql/00_compte_pont_lecture.sql` (administrateur SQL Server), puis prouver le refus d'écriture :
   `python pont_rps.py verifier-lecture-seule` (doit afficher « écriture refusée par les droits » pour les deux bases).
2. Installer : `pip install -r requirements.txt`, copier `.env.example` en `.env` (clé du CRM depuis le coffre).
3. Planificateur de tâches Windows — tâche « RPS pont CRM », **exécutée sous le compte de service lecture seule** :
   - action : `python C:\RPS\pont\pont_rps.py pousser "D:\REPORTING CLAUDE RPS"`
   - déclencheur : toutes les heures de 07:00 à 19:00 (cas de recette « un règlement sort la carte en < 1 h ») ; au minimum 07:00.
   - « Exécuter même si l'utilisateur n'est pas connecté », « Ne pas démarrer une nouvelle instance si la tâche est déjà en cours ».
4. Le journal tourne dans `PONT_JOURNAL` ; le CRM reçoit un battement (`ok` / `sage_erreur` / `crm_erreur`) à chaque exécution :
   l'écran Paramètres → Exploitation et le contrôle de santé nocturne signalent un pont muet.
5. Les TSV de secours (`sql_out\qr*.txt`) sont réécrits à chaque exécution : ils alimentent la maquette locale et l'écran SOURCE en cas de panne du CRM.
