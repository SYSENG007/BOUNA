-- 0017 — Retirer les fonctions d'événements durables de la surface anonyme.
--
-- Les neuf fonctions de 0014 ont été créées sans bloc de privilèges. Postgres
-- accorde `EXECUTE` à PUBLIC par défaut, et Supabase y ajoute `anon` : elles
-- sont donc appelables SANS authentification via `/rest/v1/rpc/<nom>`.
--
-- Ce n'est pas exploitable en l'état, et il faut le dire précisément plutôt
-- que d'agiter le mot « faille » : chacune commence par
-- `v_user := auth.uid()`, puis cherche le profil correspondant et lève
-- « Utilisateur sans organisation » si elle n'en trouve pas. Pour un appelant
-- anonyme, `auth.uid()` vaut NULL, la recherche ne rend rien, et la fonction
-- s'arrête avant d'écrire quoi que ce soit. Les neuf portent en plus une garde
-- `has_capability()` et un contrôle d'appartenance à l'organisation.
--
-- On les retire quand même de `anon`, pour une raison simple : la sécurité ne
-- doit pas reposer sur la première ligne du corps d'une fonction. Le jour où
-- quelqu'un remanie `grant_capability` et déplace ce contrôle, l'exposition
-- devient une élévation de privilèges accessible à n'importe qui sur
-- internet — et rien dans le diff ne le signalerait. Le `revoke` est la
-- ceinture ; la garde interne reste les bretelles.
--
-- `authenticated` conserve `EXECUTE` : c'est le rôle sous lequel le client
-- appelle ces fonctions depuis `transport.ts`, et le retirer couperait toute
-- la synchronisation.

revoke execute on function public.record_waste(uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, timestamptz, text) from public, anon;
revoke execute on function public.transfer_stock(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, timestamptz, text) from public, anon;
revoke execute on function public.apply_inventory_count(uuid, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, text, uuid, numeric, timestamptz, text) from public, anon;
revoke execute on function public.complete_batch(uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, numeric, jsonb, uuid, numeric, timestamptz, text) from public, anon;
revoke execute on function public.record_expense(uuid, uuid, uuid, numeric, text, text, uuid, text, timestamptz, text) from public, anon;
revoke execute on function public.open_cash_session(uuid, uuid, uuid, integer, numeric, timestamptz, text) from public, anon;
revoke execute on function public.close_cash_session(uuid, uuid, uuid, integer, numeric, numeric, numeric, numeric, text, uuid, timestamptz, text) from public, anon;
revoke execute on function public.grant_capability(uuid, text) from public, anon;
revoke execute on function public.revoke_capability(uuid, text) from public, anon;

grant execute on function public.record_waste(uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, timestamptz, text) to authenticated;
grant execute on function public.transfer_stock(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, timestamptz, text) to authenticated;
grant execute on function public.apply_inventory_count(uuid, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, text, uuid, numeric, timestamptz, text) to authenticated;
grant execute on function public.complete_batch(uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, numeric, jsonb, uuid, numeric, timestamptz, text) to authenticated;
grant execute on function public.record_expense(uuid, uuid, uuid, numeric, text, text, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.open_cash_session(uuid, uuid, uuid, integer, numeric, timestamptz, text) to authenticated;
grant execute on function public.close_cash_session(uuid, uuid, uuid, integer, numeric, numeric, numeric, numeric, text, uuid, timestamptz, text) to authenticated;
grant execute on function public.grant_capability(uuid, text) to authenticated;
grant execute on function public.revoke_capability(uuid, text) to authenticated;
