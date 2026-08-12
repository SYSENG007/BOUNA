-- =====================================================================
-- BUNA Operations — durcissement de la surface SECURITY DEFINER
-- Corrige les alertes relevées par le linter Supabase sur 0001-0003.
-- =====================================================================

-- 1. FUITE DE DONNÉES (niveau ERREUR)
--    La vue stock_levels s'exécutait avec les droits de son créateur et
--    contournait donc RLS : tout compte authentifié pouvait lire le stock de
--    TOUTES les organisations. En security_invoker, la vue applique les
--    politiques de celui qui l'interroge.
alter view public.stock_levels set (security_invoker = on);

-- 2. search_path mutable sur has_role : sans chemin fixe, un schéma placé en
--    tête de search_path peut détourner les appels internes de la fonction.
create or replace function public.has_role(roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_role_name() = any(roles)
$$;

-- 3. INTÉGRITÉ DU COÛT DE REVIENT
--    apply_weighted_average_cost écrit le coût des articles. Exposée, elle
--    permettait à n'importe quel compte authentifié de fausser les coûts,
--    donc les marges. Elle n'apparaît dans aucune politique et n'est appelée
--    que par receive_goods, qui s'exécute en SECURITY DEFINER.
--
--    Note : Postgres accorde EXECUTE à PUBLIC par défaut. Révoquer pour anon
--    seul ne produit aucun effet tant que la concession à PUBLIC subsiste.
revoke execute on function public.apply_weighted_average_cost(uuid, numeric, numeric)
  from public, anon, authenticated;

-- 4. Un utilisateur anonyme ne vend pas, n'annule pas, ne réceptionne pas.
--    Le contrôle de rôle plus fin reste fait dans le corps de chaque fonction.
revoke execute on function public.complete_sale(uuid, uuid, uuid, uuid, text, numeric, jsonb, timestamptz, text) from public, anon;
revoke execute on function public.void_sale(uuid, uuid, text)                                                    from public, anon;
revoke execute on function public.receive_goods(uuid, uuid, uuid, uuid, jsonb, numeric, text)                    from public, anon;

grant execute on function public.complete_sale(uuid, uuid, uuid, uuid, text, numeric, jsonb, timestamptz, text) to authenticated;
grant execute on function public.void_sale(uuid, uuid, text)                                                    to authenticated;
grant execute on function public.receive_goods(uuid, uuid, uuid, uuid, jsonb, numeric, text)                    to authenticated;

-- 5. Les helpers appelés DANS les politiques gardent EXECUTE — délibérément.
--    Une expression de politique est évaluée avec les droits de l'appelant :
--    sans EXECUTE, toute lecture échoue en « permission denied for function
--    current_org_id » au lieu de renvoyer un résultat vide. Vérifié en base.
--    L'exposition résiduelle est bénigne : ces fonctions ne révèlent à
--    l'appelant que sa propre organisation et son propre rôle.
grant execute on function public.current_org_id()             to anon, authenticated;
grant execute on function public.current_role_name()          to anon, authenticated;
grant execute on function public.has_role(public.user_role[]) to anon, authenticated;

comment on function public.current_org_id() is
  'Helper RLS. EXECUTE volontairement ouvert : une politique est evaluee avec les droits de l''appelant, et la revocation casse toutes les lectures. Ne revele que sa propre organisation.';

-- 6. notification_cooldowns : RLS actif sans politique = refus total, par
--    conception. Documenté pour que l'absence de politique ne passe pas
--    pour un oubli.
comment on table public.notification_cooldowns is
  'Etat interne du moteur d''alertes. RLS actif sans politique : aucun acces client, par conception. Ecrit uniquement par les fonctions serveur.';
