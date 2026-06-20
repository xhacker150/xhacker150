#!/usr/bin/env bash
# =============================================================
#  Script de déploiement ERP Stations-Service
#  Usage : ./deploy.sh <PROJECT_REF> <ANTHROPIC_API_KEY>
#  Ex.   : ./deploy.sh abcxyzprojet123 sk-ant-...
# =============================================================
set -e

PROJECT_REF="${1:?Erreur : fournir le PROJECT_REF comme 1er argument}"
ANTHROPIC_KEY="${2:?Erreur : fournir l'ANTHROPIC_API_KEY comme 2ème argument}"

echo ">>> Liaison du projet Supabase : $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo ">>> Application du schéma SQL..."
supabase db push --local schema.sql 2>/dev/null || \
  echo "    (db push non disponible — collez schema.sql dans SQL Editor)"

echo ">>> Enregistrement du secret ANTHROPIC_API_KEY..."
supabase secrets set ANTHROPIC_API_KEY="$ANTHROPIC_KEY"

echo ">>> Déploiement de la fonction analyse-claude..."
supabase functions deploy analyse-claude

echo ""
echo "=== Déploiement terminé ==="
echo "Dernière étape : renseignez supabase-config.js avec votre URL et clé anon."
echo "Puis ouvrez index.html via : python -m http.server 5173"
