#!/usr/bin/env bash
# Ce que la base a réellement reçu, comparé à ce que le dépôt contient.
#
# Relire un fichier de migration ne dit rien de l'état du serveur : les
# migrations s'appliquent à la main, souvent avant d'être committées, et un
# fichier peut être amendé après avoir tourné. C'est arrivé (voir 0026).
# Ce script répond à la seule question qui compte avant de toucher à la prod :
# « le serveur est-il d'accord avec ce que je lis ? »
#
# Usage : scripts/db-status.sh
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.aeuxvrbuihlivgabolcc@aws-1-eu-west-1.pooler.supabase.com:5432/postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$("$PG_BIN/psql" "$DB_URL" -Atqc \
      "select to_regclass('public.schema_migrations') is not null")" != "t" ]; then
  echo "Registre absent. Appliquez d'abord :" >&2
  echo "  scripts/db-apply.sh supabase/migrations/0026_registre_migrations.sql" >&2
  exit 1
fi

# Les fichiers du dépôt et leur empreinte, passés à Postgres pour qu'il fasse
# la jointure : c'est lui qui détient l'autre moitié de la comparaison.
DISQUE=""
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f")"
  s="$(shasum -a 256 "$f" | awk '{print $1}')"
  DISQUE="${DISQUE}${DISQUE:+,}('$n','$s')"
done

"$PG_BIN/psql" "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
\pset pager off
\echo
\echo '=== Le dépôt et la base, fichier par fichier ==========================='
\echo

with disque(filename, empreinte) as (values $DISQUE)
select coalesce(d.filename, r.filename) as migration,
       case
         when r.filename is null              then 'JAMAIS APPLIQUÉE'
         when d.filename is null              then 'appliquée, fichier absent du dépôt'
         when r.checksum is null              then 'adoptée — contenu non vérifié'
         when r.checksum = d.empreinte        then 'OK'
         else                                      'MODIFIÉE DEPUIS SON APPLICATION'
       end as etat,
       to_char(r.applied_at, 'YYYY-MM-DD HH24:MI') as le,
       r.note
from disque d
full outer join public.schema_migrations r on r.filename = d.filename
order by 1;

\echo
\echo '=== Ce qui demande une décision ========================================'
\echo 'Zéro ligne attendue. Une ligne ici veut dire que le dépôt affirme'
\echo 'quelque chose que la base ne confirme pas.'

with disque(filename, empreinte) as (values $DISQUE)
select coalesce(d.filename, r.filename) as migration,
       case when r.filename is null then 'jamais appliquée'
            when d.filename is null then 'plus dans le dépôt'
            else 'modifiée depuis son application' end as probleme
from disque d
full outer join public.schema_migrations r on r.filename = d.filename
where r.filename is null
   or d.filename is null
   or (r.checksum is not null and r.checksum <> d.empreinte)
order by 1;
SQL
