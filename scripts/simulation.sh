#!/usr/bin/env bash
# Le bac à sable de simulation — ouvrir, regarder, fermer.
#
#   scripts/simulation.sh start    monte l'organisation « BUNA — Simulation »
#   scripts/simulation.sh status   dit ce qu'elle contient en ce moment
#   scripts/simulation.sh stop     l'efface, elle et tout ce qu'elle a produit
#
# Aucune sauvegarde n'est exigée, contrairement à `db-apply.sh` : ces trois
# commandes ne touchent QUE l'organisation de simulation, et les scripts SQL
# refusent de s'exécuter si l'identifiant visé ne porte pas le nom attendu.
# Voir `simulation-purge.sql` pour le garde-fou.
#
# `start` est rejouable : il efface la simulation précédente avant de monter
# la nouvelle. C'est le geste « je recommence ma journée depuis le début ».
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.aeuxvrbuihlivgabolcc@aws-1-eu-west-1.pooler.supabase.com:5432/postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM_ORG='99999999-9999-9999-9999-999999999999'

run_file() { "$PG_BIN/psql" "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$1"; }

case "${1:-}" in
  start)
    echo "Montage du bac à sable…"
    echo
    run_file "$ROOT/scripts/simulation-seed.sql"
    echo
    echo "Comptes — mot de passe : simulation2026"
    echo "  patron@simu.buna.sn     Propriétaire   (tout, y compris le régime et la clôture)"
    echo "  gerant@simu.buna.sn     Manager"
    echo "  vendeur@simu.buna.sn    Vendeur        (vendre, ouvrir/fermer la caisse)"
    echo "  prepa@simu.buna.sn      Préparateur    (préparer, transférer, compter)"
    echo "  appro@simu.buna.sn      Approvisionneur (commander, réceptionner)"
    echo "  finance@simu.buna.sn    Finance        (dépenses, marges, clôture)"
    echo
    echo "Le parcours d'une journée : docs/SIMULATION.md"
    ;;

  stop)
    echo "Fermeture du bac à sable…"
    echo
    run_file "$ROOT/scripts/simulation-purge.sql"
    echo
    echo "Sur chaque appareil ayant servi à la simulation : Profil → Paramètres avancés"
    echo "→ « Réinitialiser les données locales ». Le cache d'un téléphone survit à"
    echo "tout ce qui arrive côté serveur."
    ;;

  status)
    "$PG_BIN/psql" "$DB_URL" -X -q -c "
      select
        coalesce((select name from organizations where id = '$SIM_ORG'), '— aucune simulation en cours') as organisation,
        (select count(*) from profiles        where organization_id = '$SIM_ORG') as comptes,
        (select count(*) from stock_movements where organization_id = '$SIM_ORG') as mouvements,
        (select count(*) from sales           where organization_id = '$SIM_ORG') as ventes,
        (select count(*) from expenses        where organization_id = '$SIM_ORG') as depenses,
        (select count(*) from domain_events   where organization_id = '$SIM_ORG') as evenements;"
    ;;

  *)
    echo "Usage : $0 {start|status|stop}" >&2
    exit 2
    ;;
esac
