-- 0025 — Le déclencheur d'inscription rattrape MANAGE_SETTINGS.
--
-- `handle_new_user` accorde à chaque compte le préréglage de son poste. Ces
-- préréglages sont écrits en dur dans la fonction, et ils datent de 0009. Une
-- capacité née APRÈS 0009 n'y entre pas toute seule : `MANAGE_SETTINGS`, créée
-- en 0023, n'a jamais été ajoutée au tableau du manager.
--
-- Le décalage ne se voit pas à l'écran, et c'est ce qui le rend coûteux. Côté
-- client, `MANAGER_PRESET` (src/domain/capabilities.ts) tient bien la capacité,
-- et `backfillGrants` la rattrape dans l'état local. Un manager fraîchement
-- créé voit donc l'écran du régime d'exploitation, le change, et l'application
-- lui dit oui. Puis `set_operating_mode` vérifie `has_capability` sur
-- `user_capabilities`, ne la trouve pas, et refuse : l'événement part en
-- CONFLICT. L'application a dit oui, la base a dit non, et l'écart n'apparaît
-- qu'à la synchronisation — le pire moment pour l'apprendre.
--
-- Ce que cette migration NE change pas : le préréglage reste un POINT DE
-- DÉPART, pas une règle d'autorisation. Chaque ligne accordée ici est un fait
-- daté que l'écran Équipe révoque comme n'importe quel autre.

-- --------------------------------------------------- Le déclencheur, à jour

-- `create or replace` suffit : le déclencheur `on_auth_user_created` désigne la
-- fonction par son nom, il n'a pas à être recréé. Le corps est repris intégralement
-- de 0009 — une seule ligne change, celle du pilotage dans le tableau MANAGER.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_site uuid;
  v_post public.user_post;
  v_name text;
begin
  select id into v_org  from public.organizations order by created_at limit 1;
  select id into v_site from public.sites where organization_id = v_org order by created_at limit 1;

  if v_org is null then
    -- Base non amorcée : mieux vaut aucun profil qu'un profil orphelin.
    return new;
  end if;

  v_post := coalesce(
    (new.raw_user_meta_data ->> 'post')::public.user_post,
    (new.raw_user_meta_data ->> 'role')::public.user_post,
    'SELLER'   -- par défaut, le poste dont le préréglage donne le moins
  );

  v_name := coalesce(new.raw_user_meta_data ->> 'name', initcap(split_part(new.email, '@', 1)));

  insert into public.profiles (id, organization_id, site_id, name, post)
  values (new.id, v_org, v_site, v_name, v_post)
  on conflict (id) do nothing;

  -- Le préréglage du poste, accordé par le compte lui-même faute de
  -- manager identifiable à cet instant. Chaque ligne reste révocable.
  insert into public.user_capabilities (organization_id, user_id, capability, granted_by)
  select v_org, new.id, unnest(
    case v_post
      -- `enum_range` est évalué à l'exécution : le propriétaire suit l'enum
      -- sans qu'on y touche, y compris pour une capacité ajoutée demain.
      -- C'est le seul poste que la dérive corrigée ici ne pouvait pas atteindre.
      when 'OWNER' then enum_range(null::public.capability)
      when 'MANAGER' then array[
        'SELL','VOID_SALE','MANAGE_CASH_SESSION','VIEW_ALL_SALES',
        'VIEW_STOCK','RECORD_WASTE','TRANSFER_STOCK','COUNT_INVENTORY','RESOLVE_VARIANCE',
        'PRODUCE','EDIT_RECIPE',
        'REQUEST_PURCHASE','APPROVE_PURCHASE','PLACE_ORDER','RECEIVE_GOODS','MANAGE_SUPPLIERS',
        'RECORD_EXPENSE','VIEW_FINANCES','CLOSE_DAY',
        -- `MANAGE_SETTINGS` est ici et pas au propriétaire seul : le régime
        -- d'exploitation relève de l'encadrement. C'est le manager qui est là
        -- quand la méthode ne colle plus au terrain.
        --
        -- `REOPEN_DAY` reste volontairement absent, comme côté client : rouvrir
        -- une journée clôturée défait un arrêté, et cela reste au propriétaire.
        'VIEW_DASHBOARD','MANAGE_CATALOG','MANAGE_LOCATIONS','MANAGE_TEAM','VIEW_AUDIT_LOG',
        'MANAGE_SETTINGS'
      ]::public.capability[]
      when 'FINANCE' then array[
        'RECORD_EXPENSE','VIEW_FINANCES','VIEW_AUDIT_LOG','VIEW_STOCK',
        'VIEW_DASHBOARD','VIEW_ALL_SALES','MANAGE_SUPPLIERS','CLOSE_DAY'
      ]::public.capability[]
      when 'PROCUREMENT' then array[
        'REQUEST_PURCHASE','PLACE_ORDER','RECEIVE_GOODS','MANAGE_SUPPLIERS',
        'VIEW_STOCK','RECORD_EXPENSE'
      ]::public.capability[]
      when 'PREPARER' then array[
        'PRODUCE','VIEW_STOCK','RECORD_WASTE','TRANSFER_STOCK','COUNT_INVENTORY'
      ]::public.capability[]
      else array['SELL','VIEW_STOCK','MANAGE_CASH_SESSION','RECORD_WASTE']::public.capability[]
    end
  ), new.id
  on conflict do nothing;

  return new;
end;
$$;

-- `create or replace` conserve les privilèges existants, donc le `revoke` de
-- 0009 tient toujours. On le réaffirme quand même : le coût est nul, et la
-- garantie ne repose plus sur une lecture de la documentation.
revoke execute on function public.handle_new_user() from public;

-- ------------------------------------------------- Les comptes déjà ouverts

-- 0024 portait déjà ce rattrapage. Il n'a pas suffi, pour deux raisons qui se
-- cumulent :
--
--   1. Tout compte OWNER ou MANAGER créé APRÈS l'application de 0024 est passé
--      par le déclencheur périmé, et en est donc ressorti sans la capacité.
--   2. En base, ce rattrapage n'a atteint que le propriétaire. La version de
--      0024 réellement appliquée ne couvrait pas encore le manager ; le fichier
--      a été étendu ensuite, mais une migration ne se rejoue pas.
--
-- D'où la reprise ici, à l'identique et idempotente. Le filtre sur
-- `revoked_at is null` est ce qui compte : une capacité RETIRÉE à quelqu'un
-- n'est jamais réaccordée par une mise à jour. Retirer un droit reste un fait
-- daté qu'aucune migration ne défait dans le dos du manager qui l'a décidé.
insert into public.user_capabilities (organization_id, user_id, capability, granted_by, granted_at)
select p.organization_id, p.id, 'MANAGE_SETTINGS'::public.capability, p.id, now()
  from public.profiles p
 where p.post in ('OWNER', 'MANAGER')
   and not exists (
     select 1 from public.user_capabilities uc
      where uc.user_id = p.id
        and uc.capability = 'MANAGE_SETTINGS'::public.capability
        and uc.revoked_at is null
   );

-- ------------------------------------------------------------- Le garde-fou

-- La migration prouve son propre effet plutôt que de l'annoncer. Une édition
-- ratée — mauvais tableau, littéral mal orthographié, corps repris d'une
-- version périmée — annule tout ici, et la base reste dans l'état d'avant.
do $$
declare
  v_src     text;
  v_manquant text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user';

  if v_src is null then
    raise exception 'handle_new_user est introuvable : le déclencheur d''inscription a disparu.';
  end if;

  if position('MANAGE_SETTINGS' in v_src) = 0 then
    raise exception
      'Le préréglage du manager ne mentionne toujours pas MANAGE_SETTINGS : '
      'un compte manager neuf resterait bloqué sur le régime d''exploitation.';
  end if;

  -- Le même contrôle, généralisé : toute capacité de l'enum doit apparaître
  -- quelque part dans la fonction, sauf celles qu'on réserve délibérément au
  -- propriétaire. C'est exactement la dérive corrigée ici qui se rejouerait
  -- sinon, silencieusement, à la prochaine capacité ajoutée.
  select string_agg(label::text, ', ' order by label)
    into v_manquant
    from unnest(enum_range(null::public.capability)) as label
   where label::text <> 'REOPEN_DAY'          -- propriétaire seul, assumé
     and position(label::text in v_src) = 0;

  if v_manquant is not null then
    raise exception
      'Capacités absentes des préréglages du déclencheur : %. '
      'Ajoutez-les au poste concerné, ou déclarez-les réservées au propriétaire.',
      v_manquant;
  end if;
end $$;
