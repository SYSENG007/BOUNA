-- Preuves des invariants de sécurité, à exécuter APRÈS 0009 et 0010.
--
-- Vérifier plutôt que supposer : un cache PostgREST périmé, un `revoke` sans
-- effet ou une vue SECURITY DEFINER ne se voient qu'en interrogeant la base.
-- Chaque requête rend un verdict OK / ÉCHEC. Un seul ÉCHEC condamne la
-- migration : ne laissez pas passer.
--
--   psql "$SUPABASE_DB_URL" -f supabase/verify_invariants.sql

\pset pager off
\echo
\echo '=== 1. Les helpers de politique GARDENT leur execute ==================='
\echo 'Les expressions RLS sont évaluées avec les privilèges de l''appelant.'
\echo 'Révoquer has_capability casse toutes les lectures de l''application.'

select p.proname,
       has_function_privilege('anon',          p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       case when has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')
            then 'OK' else 'ÉCHEC' end as verdict
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('has_capability', 'current_org_id')
order by 1;

\echo
\echo '=== 2. Les fonctions qui écrivent n''ont PLUS leur execute pour PUBLIC =='
\echo 'Postgres accorde à PUBLIC par défaut. Un `revoke ... from anon` seul ne'
\echo 'fait rien : la fonction reste ouverte à tout le monde.'

select p.proname,
       has_function_privilege('public', p.oid, 'execute') as public_execute,
       case when has_function_privilege('public', p.oid, 'execute')
            then 'ÉCHEC' else 'OK' end as verdict
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef                              -- SECURITY DEFINER = celles qui contournent RLS
  and p.proname not in ('has_capability', 'current_org_id')
order by public_execute desc, 1;

\echo
\echo '=== 3. Toute vue est security_invoker ================================='
\echo 'Une vue SECURITY DEFINER contourne RLS et fuite entre organisations.'

select c.relname,
       case when c.reloptions::text like '%security_invoker=on%'
            then 'OK' else 'ÉCHEC' end as verdict,
       coalesce(c.reloptions::text, '(aucune option)') as options
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by 2 desc, 1;

\echo
\echo '=== 4. Toute table exposée porte RLS =================================='
\echo 'Zéro ligne attendue. Chaque ligne rendue est une table lisible par tous.'

select c.relname as table_sans_rls, 'ÉCHEC' as verdict
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1;

\echo
\echo '=== 5. Les 25 capacités sont bien en base ============================='

select count(*) as capacites,
       case when count(*) = 25 then 'OK' else 'ÉCHEC' end as verdict
from pg_enum e join pg_type t on t.oid = e.enumtypid
where t.typname = 'capability';

\echo
\echo '=== 6. Un accord actif est unique, un accord révoqué ne l''est plus ===='
\echo 'L''index partiel est ce qui autorise l''historique : on peut accorder,'
\echo 'révoquer, puis ré-accorder la même capacité sans violer l''unicité.'

select indexname,
       case when indexdef like '%revoked_at IS NULL%' then 'OK' else 'ÉCHEC' end as verdict
from pg_indexes
where schemaname = 'public' and tablename = 'user_capabilities' and indexdef like '%UNIQUE%';

\echo
\echo '=== 7. Les colonnes actor existent sur les 7 tables tracées ==========='

select table_name,
       case when count(*) filter (where column_name in
              ('actor_user_id','actor_user_name','actor_post','actor_capability')) = 4
            then 'OK' else 'ÉCHEC (' || count(*) filter (where column_name like 'actor_%') || '/4)' end as verdict
from information_schema.columns
where table_schema = 'public'
  and table_name in ('stock_movements','sales','production_batches','purchases',
                     'expenses','waste_events','inventory_counts')
group by table_name
order by 1;

\echo
\echo '=== 8. Une résolution d''écart est définitive ==========================='
\echo 'La politique de mise à jour doit exiger `resolution is null` : sans elle,'
\echo 'un écart soldé « perte » peut être requalifié « erreur de saisie » après'
\echo 'coup, et le premier motif — le seul honnête — disparaît.'

select policyname,
       case when qual like '%resolution IS NULL%' then 'OK' else 'ÉCHEC' end as verdict
from pg_policies
where schemaname = 'public' and tablename = 'variances' and cmd = 'UPDATE';

\echo
\echo '=== RESTE À FAIRE À LA MAIN : le refus effectif ========================'
\echo 'Les vérifications ci-dessus prouvent la forme, pas le comportement.'
\echo 'Avec deux comptes réels, l''un SANS la capacité RECEIVE_GOODS :'
\echo '  set local role authenticated;'
\echo '  set local request.jwt.claims = ''{"sub":"<uuid-sans-la-capacite>"}'';'
\echo '  select receive_goods(...);   -- DOIT lever une exception'
\echo 'Si les deux comptes passent, la garde est décorative.'
\echo
\echo 'Et l''idempotence : appeler complete_sale deux fois avec le MÊME event.id'
\echo 'doit créer UNE seule vente. C''est ce qui empêche un retry réseau de'
\echo 'facturer deux fois un client.'
\echo
