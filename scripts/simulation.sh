#!/usr/bin/env bash
# Le bac à sable de simulation, depuis un terminal.
#
# LE CHEMIN NORMAL EST L'APPLICATION : /pilotage/simulation, à taper dans la
# barre d'adresse. Aucun lien ne mène à cette page — c'est voulu, le bac à sable
# ne doit pas se découvrir en explorant les menus. Il faut la capacité
# « Simuler une journée » (propriétaires et managers par défaut).
#
#   scripts/simulation.sh start    monte le bac à sable sans y entrer
#   scripts/simulation.sh status   dit ce qu'il contient en ce moment
#   scripts/simulation.sh stop     l'efface, et ramène qui y travaillait encore
#
# Ce script ne fait qu'appeler les fonctions de la base
# (`supabase/migrations/0030_bac_a_sable.sql`) : il n'existe qu'UNE description
# du bac à sable, et c'est elle. Il sert quand on veut préparer les données sans
# ouvrir l'interface — avant une démonstration, par exemple.
#
# Il ne crée aucun compte. Chacun entre avec le sien et y garde ses propres
# droits : c'est la question utile (« est-ce que MOI je peux tenir une
# journée ? »), et il n'y a aucun mot de passe partagé dans le dépôt.
#
# Aucune sauvegarde n'est exigée, contrairement à `db-apply.sh` : ces commandes
# ne touchent que l'organisation de simulation, et `purge_simulation` refuse
# d'agir si l'organisation visée ne porte pas le nom attendu.
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.aeuxvrbuihlivgabolcc@aws-1-eu-west-1.pooler.supabase.com:5432/postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run_file() { "$PG_BIN/psql" "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$1"; }

case "${1:-}" in
  start)
    echo "Montage du bac à sable…"
    echo
    run_file "$ROOT/scripts/simulation-seed.sql"
    echo
    echo "Prêt. Pour y entrer : ouvrez /pilotage/simulation dans l'application."
    echo "Le parcours d'une journée : docs/SIMULATION.md"
    ;;

  stop)
    echo "Fermeture du bac à sable…"
    echo
    run_file "$ROOT/scripts/simulation-purge.sql"
    echo
    echo "Sur chaque appareil ayant servi : Profil → Paramètres avancés"
    echo "→ « Réinitialiser les données locales ». Le cache d'un téléphone survit"
    echo "à tout ce qui arrive côté serveur."
    ;;

  status)
    "$PG_BIN/psql" "$DB_URL" -X -q -c "
      select
        coalesce((select name from organizations where id = public.simulation_org_id()),
                 '— aucune simulation en cours') as organisation,
        (select count(*) from profiles       where organization_id = public.simulation_org_id()) as personnes_dedans,
        (select count(*) from stock_movements where organization_id = public.simulation_org_id()) as mouvements,
        (select count(*) from sales          where organization_id = public.simulation_org_id()) as ventes,
        (select count(*) from expenses       where organization_id = public.simulation_org_id()) as depenses;"
    ;;

  *)
    echo "Usage : $0 {start|status|stop}" >&2
    exit 2
    ;;
esac
