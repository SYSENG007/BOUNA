#!/usr/bin/env bash
# Applique un fichier de migration au projet distant, en une seule transaction.
#
# --single-transaction + ON_ERROR_STOP : le DDL est transactionnel en
# PostgreSQL, donc si la migration casse à la ligne 900, tout est annulé et la
# base reste exactement dans l'état d'avant. Le filet, c'est Postgres lui-même.
#
# Usage : scripts/db-apply.sh supabase/migrations/0009_capabilities.sql
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.aeuxvrbuihlivgabolcc@aws-1-eu-west-1.pooler.supabase.com:5432/postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -ne 1 ]; then
  echo "Usage : $0 <fichier.sql>" >&2
  exit 2
fi
MIGRATION="$1"
[ -f "$MIGRATION" ] || { echo "Introuvable : $MIGRATION" >&2; exit 2; }

# Refus de migrer sans sauvegarde du jour. Le rollback transactionnel protège
# d'un échec, pas d'une migration qui réussit en faisant la mauvaise chose.
RECENT="$(find "$ROOT/backups" -name 'buna-*.dump' -mtime -1 2>/dev/null | head -1 || true)"
if [ -z "$RECENT" ]; then
  echo "Aucune sauvegarde de moins de 24 h dans backups/." >&2
  echo "Lancez d'abord : scripts/db-backup.sh" >&2
  exit 1
fi
echo "Sauvegarde trouvée : $(basename "$RECENT")"
echo "Application de $(basename "$MIGRATION")…"
echo

"$PG_BIN/psql" "$DB_URL" \
  -v ON_ERROR_STOP=1 --single-transaction \
  -f "$MIGRATION"

echo
echo "Appliquée. Vérifiez maintenant en base :"
echo "  $PG_BIN/psql \"\$SUPABASE_DB_URL\" -f supabase/verify_invariants.sql"
