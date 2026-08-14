#!/usr/bin/env bash
# Sauvegarde du projet Supabase distant.
#
# Le plan gratuit ne fait AUCUNE sauvegarde automatique. Personne ne le fera à
# votre place : ce script est le seul filet, et il ne se déclenche pas tout seul.
#
# Le mot de passe n'est jamais écrit ici ni stocké. pg_dump le demande à
# l'invite, ou le lit dans ~/.pgpass si vous en avez un.
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.aeuxvrbuihlivgabolcc@aws-1-eu-west-1.pooler.supabase.com:5432/postgres}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"

# Diagnostic lisible plutôt que deux FATAL en anglais. La cause est presque
# toujours la même : le mot de passe de la BASE n'est pas celui du compte
# Supabase. Il se réinitialise dans Project Settings → Database.
if grep -q 'REMPLACER_PAR_LE_MOT_DE_PASSE' "$HOME/.pgpass" 2>/dev/null; then
  echo "Le mot de passe n'est pas encore renseigné dans ~/.pgpass." >&2
  echo "Supabase → Project Settings → Database → Reset database password," >&2
  echo "puis collez-le en dernier champ de la ligne, après le dernier « : »." >&2
  exit 1
fi

if ! "$PG_BIN/psql" "$DB_URL" -Atqc 'select 1' >/dev/null 2>&1; then
  echo "Connexion refusée par le pooler Supabase." >&2
  echo "Le réseau et le nom d'utilisateur sont bons ; c'est le mot de passe." >&2
  echo "Ce n'est PAS celui du compte Supabase : c'est celui de la base," >&2
  echo "dans Project Settings → Database → Reset database password." >&2
  exit 1
fi
echo "Connexion établie."

# Format custom : compressé et restaurable sélectivement avec pg_restore.
echo "→ Sauvegarde complète (schéma + données) de public…"
"$PG_BIN/pg_dump" "$DB_URL" \
  --format=custom --no-owner --schema=public \
  --file="$DEST/buna-$STAMP.dump"

# Un second dump en texte, schéma seul : c'est celui qu'on lit et qu'on diffe
# après une migration pour voir ce qui a réellement changé.
echo "→ Schéma seul, en texte lisible…"
"$PG_BIN/pg_dump" "$DB_URL" \
  --schema-only --no-owner --schema=public \
  --file="$DEST/buna-$STAMP.schema.sql"

# Une sauvegarde vide est pire qu'aucune : elle donne l'illusion du filet.
for f in "$DEST/buna-$STAMP.dump" "$DEST/buna-$STAMP.schema.sql"; do
  if [ ! -s "$f" ]; then
    echo "ÉCHEC : $f est vide. Ne migrez pas." >&2
    exit 1
  fi
done

echo
echo "Sauvegarde faite :"
ls -lh "$DEST/buna-$STAMP".* | awk '{print "  " $9 "  " $5}'
echo
echo "Restauration éventuelle :"
echo "  $PG_BIN/pg_restore --clean --if-exists --no-owner -d \"\$SUPABASE_DB_URL\" $DEST/buna-$STAMP.dump"
