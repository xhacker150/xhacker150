#!/usr/bin/env bash
# Recette SQL locale : PostgreSQL joignable via PGHOST/PGUSER/PGPASSWORD (par défaut localhost / crm_user / crm_pass).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-crm_user}" PGPASSWORD="${PGPASSWORD:-crm_pass}"
BASE="${PGDATABASE_TEST:-crm_test}"
psql -d postgres -q -c "DROP DATABASE IF EXISTS $BASE;" -c "CREATE DATABASE $BASE;"
psql -d "$BASE" -q -v ON_ERROR_STOP=1 -f supabase/local-auth-stub.sql
for f in supabase/migrations/*.sql; do psql -d "$BASE" -q -v ON_ERROR_STOP=1 -f "$f"; done
python3 pont/donnees_synthetiques.py --sql /tmp/charge.sql > /dev/null
psql -d "$BASE" -v ON_ERROR_STOP=1 -v charge=/tmp/charge.sql -f supabase/tests/recette.sql 2>&1 | grep -E "NOTICE|ERROR|RECETTE" | grep -v pg_cron
