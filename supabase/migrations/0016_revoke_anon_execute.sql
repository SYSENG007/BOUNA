-- 0016 — Refermer la surface exposée à `anon`.
--
-- La section « Droits d'exécution » de 0008 n'a jamais été exécutée : les
-- objets de cette migration existent en base, mais parce que 0011 les a
-- recréés — pas parce que 0008 a tourné. Ses `revoke` sont donc restés lettre
-- morte, et les fonctions gardent le `EXECUTE` que Postgres accorde à PUBLIC
-- par défaut, plus un `anon=X` hérité du rôle Supabase.
--
-- Le cas qui compte est `recommended_production` : elle est SECURITY DEFINER,
-- donc elle s'exécute avec les droits de son propriétaire et contourne RLS.
-- Exposée à `anon`, elle est appelable SANS authentification via
-- `/rest/v1/rpc/recommended_production` — il suffit d'un identifiant de site
-- pour lire des recommandations dérivées de l'historique des ventes.
--
-- `stamp_actor` est arrivée plus tard, avec 0012, et porte le même défaut.
-- C'est une fonction de déclencheur : Postgres ne vérifie pas `EXECUTE` pour
-- les déclencheurs, lui retirer ce droit ne casse donc aucune écriture.
--
-- Ce qu'on ne touche PAS : `current_org_id()` et `has_capability()`. Les
-- expressions de politique RLS sont évaluées avec les privilèges de
-- l'APPELANT ; leur retirer `execute` ne durcit rien, ça fait échouer toutes
-- les lectures en « permission denied for function ». Voir CLAUDE.md, 0004,
-- et le test 1 de `verify_invariants.sql` qui vérifie qu'elles le gardent.
--
-- Vérifié avant écriture : aucun appel côté client, et aucune des quatre vues
-- `security_invoker = on` n'utilise ces fonctions — donc aucune lecture ne
-- dépend de ces droits.

revoke execute on function public.recommended_production(uuid, int, int)  from public, anon;
revoke execute on function public.made_to_order_unit_cost(uuid)           from public, anon;
revoke execute on function public.current_recipe_version(uuid)            from public, anon;
revoke execute on function public.convert_qty(numeric, public.unit_code, public.unit_code) from public, anon;
revoke execute on function public.unit_base(public.unit_code)             from public, anon;
revoke execute on function public.unit_factor(public.unit_code)           from public, anon;
revoke execute on function public.stamp_actor()                           from public, anon;

grant execute on function public.recommended_production(uuid, int, int)   to authenticated;
grant execute on function public.made_to_order_unit_cost(uuid)            to authenticated;
grant execute on function public.current_recipe_version(uuid)             to authenticated;
grant execute on function public.convert_qty(numeric, public.unit_code, public.unit_code) to authenticated;
grant execute on function public.unit_base(public.unit_code)              to authenticated;
grant execute on function public.unit_factor(public.unit_code)            to authenticated;
