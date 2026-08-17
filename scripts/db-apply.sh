#!/usr/bin/env bash
# Applique un fichier de migration au projet distant, en une seule transaction.
#
# --single-transaction + ON_ERROR_STOP : le DDL est transactionnel en
# PostgreSQL, donc si la migration casse à la ligne 900, tout est annulé et la
# base reste exactement dans l'état d'avant. Le filet, c'est Postgres lui-même.
#
# Depuis 0026, chaque application est ENREGISTRÉE avec l'empreinte du fichier.
# Ce n'est pas de la comptabilité : `0024_regime_exploitation.sql` a été
# appliquée, puis le fichier a été étendu, et deux managers sont restés sans la
# capacité que le dépôt leur donnait. Personne ne pouvait le voir. Le script
# refuse désormais un fichier modifié depuis son application.
#
# Usage : scripts/db-apply.sh [--rejouer] supabase/migrations/0009_capabilities.sql
#   --rejouer  applique quand même une migration déjà enregistrée (utile quand
#              on a corrigé un commentaire et qu'on veut réaligner la base).
#   --malgre-les-suivantes  autorise le rejeu d'une migration ANCIENNE, au
#              risque de défaire ce que les suivantes ont fait. Voir plus bas.
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.aeuxvrbuihlivgabolcc@aws-1-eu-west-1.pooler.supabase.com:5432/postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

REJOUER=0
MALGRE=0
MIGRATION=""
for arg in "$@"; do
  case "$arg" in
    --rejouer) REJOUER=1 ;;
    --malgre-les-suivantes) MALGRE=1 ;;
    -*) echo "Option inconnue : $arg" >&2; exit 2 ;;
    *)  MIGRATION="$arg" ;;
  esac
done

if [ -z "$MIGRATION" ]; then
  echo "Usage : $0 [--rejouer] <fichier.sql>" >&2
  exit 2
fi
[ -f "$MIGRATION" ] || { echo "Introuvable : $MIGRATION" >&2; exit 2; }

NOM="$(basename "$MIGRATION")"
EMPREINTE="$(shasum -a 256 "$MIGRATION" | awk '{print $1}')"

# Refus de migrer sans sauvegarde du jour. Le rollback transactionnel protège
# d'un échec, pas d'une migration qui réussit en faisant la mauvaise chose.
RECENT="$(find "$ROOT/backups" -name 'buna-*.dump' -mtime -1 2>/dev/null | head -1 || true)"
if [ -z "$RECENT" ]; then
  echo "Aucune sauvegarde de moins de 24 h dans backups/." >&2
  echo "Lancez d'abord : scripts/db-backup.sh" >&2
  exit 1
fi
echo "Sauvegarde trouvée : $(basename "$RECENT")"

# ------------------------------------------------------------- Le registre

# Le registre peut ne pas exister : sur une base antérieure à 0026, ou pendant
# l'application de 0026 elle-même. Son absence n'est pas une erreur — elle
# retire seulement le garde-fou, et on le dit.
REGISTRE="$("$PG_BIN/psql" "$DB_URL" -Atqc \
  "select to_regclass('public.schema_migrations') is not null" 2>/dev/null || echo "f")"

ENREGISTRE=""
if [ "$REGISTRE" = "t" ]; then
  # Par l'entrée standard, et non par `-c` : psql n'interpole PAS ses
  # variables dans `-c`. Le nom de fichier passe donc par :'f', correctement
  # mis entre quotes par psql lui-même, plutôt que collé dans la requête.
  ENREGISTRE="$("$PG_BIN/psql" "$DB_URL" -Atq -v f="$NOM" -f - <<'REQ'
select coalesce(checksum, '@adoptee') from public.schema_migrations where filename = :'f';
REQ
)"
fi

if [ "$REGISTRE" != "t" ]; then
  echo "Registre absent : cette application ne sera pas enregistrée."
  echo "Appliquez supabase/migrations/0026_registre_migrations.sql pour l'activer."

elif [ "$ENREGISTRE" = "$EMPREINTE" ]; then
  if [ "$REJOUER" -eq 0 ]; then
    echo
    echo "Déjà appliquée, et le fichier n'a pas changé depuis."
    echo "Rien à faire. Pour l'appliquer quand même : $0 --rejouer $MIGRATION"
    exit 0
  fi
  echo "Déjà appliquée à l'identique — rejeu demandé."

elif [ -n "$ENREGISTRE" ] && [ "$ENREGISTRE" != "@adoptee" ]; then
  # Le cas 0024. Le fichier a bougé APRÈS avoir tourné : ce que dit le dépôt
  # n'est pas ce que fait la base, et appliquer sans le dire referme le piège.
  echo >&2
  echo "ARRÊT : ce fichier a été modifié depuis son application." >&2
  echo >&2
  echo "  fichier   $NOM" >&2
  echo "  appliqué  $ENREGISTRE" >&2
  echo "  actuel    $EMPREINTE" >&2
  echo >&2
  echo "La base ne contient donc PAS ce que ce fichier décrit. Deux issues :" >&2
  echo "  — écrire une nouvelle migration qui porte l'écart (préférable :" >&2
  echo "    une migration déjà appliquée est un fait historique) ;" >&2
  echo "  — ou rejouer celui-ci s'il est idempotent : $0 --rejouer $MIGRATION" >&2
  exit 1

elif [ "$ENREGISTRE" = "@adoptee" ]; then
  echo "Déjà enregistrée, mais ADOPTÉE : son contenu n'a jamais été vérifié."
  if [ "$REJOUER" -eq 0 ]; then
    echo "Rien à faire. Pour réaligner la base sur ce fichier :" 
    echo "  $0 --rejouer $MIGRATION"
    exit 0
  fi
  echo "Rejeu demandé : l'empreinte réelle sera enregistrée."
fi

# Rejouer une migration ANCIENNE la fait tourner avec le contenu d'aujourd'hui
# par-dessus l'état d'aujourd'hui. Un `create or replace function` d'une
# migration de la semaine dernière écrase alors la version qu'une migration plus
# récente a installée — sans erreur, sans trace, et la base recule d'un cran.
# Concrètement : rejouer 0025 aujourd'hui réinstallerait les préréglages en dur
# que 0027 vient de remplacer par une table.
if [ "$REJOUER" -eq 1 ] && [ "$REGISTRE" = "t" ] && [ "$MALGRE" -eq 0 ]; then
  SUIVANTES="$("$PG_BIN/psql" "$DB_URL" -Atq -v f="$NOM" -f - <<'REQ'
select string_agg(filename, ', ' order by filename)
  from public.schema_migrations where filename > :'f';
REQ
)"
  if [ -n "$SUIVANTES" ]; then
    echo >&2
    echo "ARRÊT : $NOM n'est pas la dernière migration appliquée." >&2
    echo >&2
    echo "  appliquées après elle : $SUIVANTES" >&2
    echo >&2
    echo "La rejouer ferait tourner son contenu PAR-DESSUS le leur. Tout" >&2
    echo "\`create or replace\` qu'elle contient écraserait la version que les" >&2
    echo "suivantes ont installée, sans erreur et sans trace." >&2
    echo >&2
    echo "Écrivez plutôt une nouvelle migration. Si vous savez que celle-ci est" >&2
    echo "sans effet de bord sur les suivantes :" >&2
    echo "  $0 --rejouer --malgre-les-suivantes $MIGRATION" >&2
    exit 1
  fi
fi

echo "Application de $NOM…"
echo

if [ "$REGISTRE" = "t" ]; then
  # L'enregistrement se fait DANS la même transaction que la migration : une
  # migration qui échoue ne doit pas laisser une ligne affirmant qu'elle a
  # réussi. `-f -` lit l'entrée standard, seul mode où psql interpole :'f'.
  "$PG_BIN/psql" "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -v f="$NOM" -v c="$EMPREINTE" \
    -f "$MIGRATION" -f - <<'REG'
insert into public.schema_migrations (filename, checksum, note)
values (:'f', :'c', null)
on conflict (filename) do update
  set checksum = excluded.checksum, applied_at = now(),
      applied_by = current_user, note = null;
REG
else
  "$PG_BIN/psql" "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$MIGRATION"
fi

echo
echo "Appliquée. Vérifiez maintenant en base :"
echo "  $PG_BIN/psql \"\$SUPABASE_DB_URL\" -f supabase/verify_invariants.sql"
