-- 0027 — Les préréglages du déclencheur deviennent des données.
--
-- Deux fois de suite, le même défaut. Les préréglages de `handle_new_user`
-- étaient des tableaux écrits en dur, datés de 0009 : `MANAGE_SETTINGS`, née en
-- 0023, n'y est jamais entrée (corrigé en 0025), et rien n'empêchait la
-- troisième fois. Un tableau en dur dans un corps de fonction ne se compare à
-- rien : ni à l'enum, ni au client, ni à quoi que ce soit qu'une machine sache
-- relire.
--
-- Le préréglage devient donc une TABLE. Ce n'est pas un déplacement cosmétique :
-- une table se compte, se joint, se compare. `verify_invariants.sql` peut
-- désormais demander « quelle capacité n'est proposée à personne ? » et obtenir
-- une réponse, ce qu'aucune requête ne pouvait tirer d'un `case` en plpgsql.
--
-- CE QUE ÇA NE CHANGE PAS : le préréglage reste un POINT DE DÉPART. La table
-- ne décide d'aucun accès — elle dit seulement ce qu'on coche à la création
-- d'un compte. L'autorisation, elle, se lit toujours dans `user_capabilities`,
-- un fait daté révocable. Personne ne gagne ni ne perd un droit ici.
--
-- POURQUOI PAS DE CÔTÉ CLIENT : l'application doit fonctionner sans réseau
-- (RULE-010). `POST_PRESET` reste donc compilé dans le bundle — un appareil qui
-- ouvre un compte hors ligne ne peut pas interroger cette table. Il y a bien
-- deux représentations, et c'est irréductible. Ce qui ne l'est pas, c'est
-- qu'elles puissent diverger en silence : `prereglages.test.ts` relit ce
-- fichier et échoue si les deux ne disent pas exactement la même chose.

-- ------------------------------------------------------------------- Table

-- Pas d'`organization_id` : le préréglage est une décision produit, la même
-- pour toute maison qui installe l'application. Une organisation qui veut
-- autre chose ne change pas le préréglage — elle accorde et révoque, ce qui
-- est précisément le geste que la refonte des capacités a rendu possible.
create table if not exists public.post_capability_preset (
  post       public.user_post not null,
  capability public.capability not null,
  primary key (post, capability)
);

comment on table public.post_capability_preset is
  'Ce qu''on coche par défaut à la création d''un compte, par poste. Point de '
  'départ, jamais règle d''autorisation : l''accès se lit dans user_capabilities. '
  'Doit rester identique à POST_PRESET (src/domain/capabilities.ts), ce que '
  'src/domain/__tests__/prereglages.test.ts vérifie.';

alter table public.post_capability_preset enable row level security;

-- Lisible par toute personne connectée : l'écran Équipe s'en sert pour montrer
-- « voici ce que ce poste reçoit d'ordinaire ». Rien de sensible — c'est une
-- table de référence, identique pour tout le monde.
drop policy if exists post_capability_preset_read on public.post_capability_preset;
create policy post_capability_preset_read on public.post_capability_preset
  for select to authenticated using (true);

-- Aucune politique d'écriture, donc RLS refuse déjà toute écriture. On révoque
-- quand même les privilèges : Supabase accorde par défaut, et une politique
-- ajoutée par distraction demain suffirait sinon à ouvrir la table.
revoke insert, update, delete on public.post_capability_preset from anon, authenticated;
grant select on public.post_capability_preset to authenticated;

-- --------------------------------------------------------------------- Seed

-- Ces lignes ne sont pas recopiées à la main : elles sont produites depuis
-- `POST_PRESET`, et le test les recompare à chaque exécution de la suite.
--
-- Le propriétaire est stocké en clair plutôt que déduit d'`enum_range`. C'est
-- un choix, et il se paie : une capacité ajoutée demain ne lui reviendra plus
-- toute seule, il faudra une ligne. En échange, plus rien n'est accordé à
-- personne sans qu'une ligne le dise, et l'invariant 9 refuse toute capacité
-- que personne ne propose. Un droit qui apparaît sans qu'on l'ait écrit est
-- exactement ce qu'on cherche à rendre impossible.
delete from public.post_capability_preset;
insert into public.post_capability_preset (post, capability) values
  -- OWNER — 26 capacités
  ('OWNER','SELL'),
  ('OWNER','VOID_SALE'),
  ('OWNER','MANAGE_CASH_SESSION'),
  ('OWNER','VIEW_ALL_SALES'),
  ('OWNER','VIEW_STOCK'),
  ('OWNER','RECORD_WASTE'),
  ('OWNER','TRANSFER_STOCK'),
  ('OWNER','COUNT_INVENTORY'),
  ('OWNER','RESOLVE_VARIANCE'),
  ('OWNER','PRODUCE'),
  ('OWNER','EDIT_RECIPE'),
  ('OWNER','REQUEST_PURCHASE'),
  ('OWNER','APPROVE_PURCHASE'),
  ('OWNER','PLACE_ORDER'),
  ('OWNER','RECEIVE_GOODS'),
  ('OWNER','MANAGE_SUPPLIERS'),
  ('OWNER','RECORD_EXPENSE'),
  ('OWNER','VIEW_FINANCES'),
  ('OWNER','CLOSE_DAY'),
  ('OWNER','REOPEN_DAY'),
  ('OWNER','VIEW_DASHBOARD'),
  ('OWNER','MANAGE_CATALOG'),
  ('OWNER','MANAGE_LOCATIONS'),
  ('OWNER','MANAGE_TEAM'),
  ('OWNER','VIEW_AUDIT_LOG'),
  ('OWNER','MANAGE_SETTINGS'),
  -- MANAGER — 25 capacités
  ('MANAGER','SELL'),
  ('MANAGER','VIEW_STOCK'),
  ('MANAGER','MANAGE_CASH_SESSION'),
  ('MANAGER','RECORD_WASTE'),
  ('MANAGER','PRODUCE'),
  ('MANAGER','TRANSFER_STOCK'),
  ('MANAGER','COUNT_INVENTORY'),
  ('MANAGER','REQUEST_PURCHASE'),
  ('MANAGER','PLACE_ORDER'),
  ('MANAGER','RECEIVE_GOODS'),
  ('MANAGER','MANAGE_SUPPLIERS'),
  ('MANAGER','RECORD_EXPENSE'),
  ('MANAGER','VOID_SALE'),
  ('MANAGER','VIEW_ALL_SALES'),
  ('MANAGER','RESOLVE_VARIANCE'),
  ('MANAGER','EDIT_RECIPE'),
  ('MANAGER','APPROVE_PURCHASE'),
  ('MANAGER','VIEW_FINANCES'),
  ('MANAGER','CLOSE_DAY'),
  ('MANAGER','VIEW_DASHBOARD'),
  ('MANAGER','MANAGE_CATALOG'),
  ('MANAGER','MANAGE_LOCATIONS'),
  ('MANAGER','MANAGE_TEAM'),
  ('MANAGER','VIEW_AUDIT_LOG'),
  ('MANAGER','MANAGE_SETTINGS'),
  -- FINANCE — 8 capacités
  ('FINANCE','RECORD_EXPENSE'),
  ('FINANCE','VIEW_FINANCES'),
  ('FINANCE','VIEW_AUDIT_LOG'),
  ('FINANCE','VIEW_STOCK'),
  ('FINANCE','VIEW_DASHBOARD'),
  ('FINANCE','VIEW_ALL_SALES'),
  ('FINANCE','MANAGE_SUPPLIERS'),
  ('FINANCE','CLOSE_DAY'),
  -- PROCUREMENT — 6 capacités
  ('PROCUREMENT','REQUEST_PURCHASE'),
  ('PROCUREMENT','PLACE_ORDER'),
  ('PROCUREMENT','RECEIVE_GOODS'),
  ('PROCUREMENT','MANAGE_SUPPLIERS'),
  ('PROCUREMENT','VIEW_STOCK'),
  ('PROCUREMENT','RECORD_EXPENSE'),
  -- PREPARER — 5 capacités
  ('PREPARER','PRODUCE'),
  ('PREPARER','VIEW_STOCK'),
  ('PREPARER','RECORD_WASTE'),
  ('PREPARER','TRANSFER_STOCK'),
  ('PREPARER','COUNT_INVENTORY'),
  -- SELLER — 4 capacités
  ('SELLER','SELL'),
  ('SELLER','VIEW_STOCK'),
  ('SELLER','MANAGE_CASH_SESSION'),
  ('SELLER','RECORD_WASTE');

-- ------------------------------------------------------- Le déclencheur lit

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

  -- Un poste sans aucune ligne de préréglage n'est pas un poste discret : c'est
  -- la table vidée par accident. Créer quand même le compte donnerait quelqu'un
  -- qui se connecte et ne peut rien faire, sans que personne comprenne pourquoi
  -- — le défaut même que cette migration corrige. On échoue bruyamment.
  if not exists (select 1 from public.post_capability_preset where post = v_post) then
    raise exception
      'Aucun préréglage enregistré pour le poste %. La table '
      'post_capability_preset est vide ou incomplète : le compte n''est pas créé, '
      'car il n''aurait accès à rien.', v_post;
  end if;

  -- Le préréglage du poste, accordé par le compte lui-même faute de
  -- manager identifiable à cet instant. Chaque ligne reste révocable.
  insert into public.user_capabilities (organization_id, user_id, capability, granted_by)
  select v_org, new.id, pcp.capability, new.id
    from public.post_capability_preset pcp
   where pcp.post = v_post
  on conflict do nothing;

  return new;
end;
$$;

-- `create or replace` conserve les privilèges, mais on réaffirme : le coût est
-- nul et la garantie cesse de dépendre d'une lecture de la documentation.
revoke execute on function public.handle_new_user() from public;

-- ------------------------------------------------------------- Le garde-fou

-- La migration prouve son effet plutôt que de l'annoncer. Tout échec ici annule
-- la transaction entière et la base reste dans l'état d'avant.
do $$
declare
  v_orphelines text;
  v_postes     text;
  v_total      int;
begin
  select count(*) into v_total from public.post_capability_preset;
  if v_total = 0 then
    raise exception 'Le seed des préréglages n''a rien inséré.';
  end if;

  -- Toute capacité de l'enum doit être proposée à au moins un poste. C'est
  -- exactement la dérive de 0023→0025 : une valeur ajoutée que personne ne
  -- reçoit. Elle ne peut plus passer inaperçue.
  select string_agg(label::text, ', ' order by label) into v_orphelines
    from unnest(enum_range(null::public.capability)) as label
   where not exists (
     select 1 from public.post_capability_preset p where p.capability = label
   );
  if v_orphelines is not null then
    raise exception
      'Capacités proposées à aucun poste : %. Ajoutez-les au préréglage '
      'concerné — sans quoi personne ne les recevra jamais à l''inscription.',
      v_orphelines;
  end if;

  -- Et tout poste doit avoir un préréglage, sinon l'inscription échouera.
  select string_agg(label::text, ', ' order by label) into v_postes
    from unnest(enum_range(null::public.user_post)) as label
   where not exists (
     select 1 from public.post_capability_preset p where p.post = label
   );
  if v_postes is not null then
    raise exception 'Postes sans aucun préréglage : %.', v_postes;
  end if;
end $$;
