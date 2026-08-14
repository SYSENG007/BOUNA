-- =====================================================================
-- 0009 — Le poste n'autorise plus rien. La capacité, si.
--
-- Jusqu'ici, accorder un droit à quelqu'un demandait une migration SQL :
-- les vingt politiques et les neuf fonctions transactionnelles nommaient
-- des rôles en dur. Sur le terrain, les employés sont polyvalents — un
-- vendeur réceptionne le mardi matin — et le système leur demandait de
-- porter deux rôles, ce qui n'est pas la même chose.
--
-- Cette migration sépare deux notions que l'enum `user_role` confondait :
--
--   • le POSTE  — une identité sociale : stable, unique, affichée ;
--   • la CAPACITÉ — le droit d'exécuter une opération : accordée par
--     quelqu'un, datée, révocable.
--
-- Un accord est un fait daté, comme un mouvement de stock : on ne
-- l'écrase pas, on le révoque en datant sa fin. « Qui avait le droit de
-- réceptionner le 12 août ? » redevient une question à laquelle la base
-- répond.
--
-- Personne ne perd d'accès aujourd'hui : le backfill dérive les
-- capacités initiales des rôles en place.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. LE POSTE
--
-- Mêmes valeurs que `user_role` : la donnée n'a rien à réécrire, seul
-- son sens change. On renomme la colonne pour que le code qui la lit
-- soit obligé de constater le changement plutôt que de le subir.
-- ---------------------------------------------------------------------

create type public.user_post as enum
  ('OWNER','MANAGER','PROCUREMENT','PREPARER','SELLER','FINANCE');

alter table public.profiles
  alter column role type public.user_post using role::text::public.user_post;
alter table public.profiles rename column role to post;

alter table public.audit_events
  alter column role type public.user_post using role::text::public.user_post;
alter table public.audit_events rename column role to post;

-- Sous quelle autorisation l'opération a été faite. C'est ce qui
-- distingue cette traçabilité d'une simple colonne `user_id` : quand un
-- vendeur réceptionne, le journal dit de qui il tenait ce droit.
alter table public.audit_events add column if not exists capability text;

-- ---------------------------------------------------------------------
-- 2. LES CAPACITÉS
-- ---------------------------------------------------------------------

create type public.capability as enum (
  'SELL','VOID_SALE','MANAGE_CASH_SESSION','VIEW_ALL_SALES',
  'VIEW_STOCK','RECORD_WASTE','TRANSFER_STOCK','COUNT_INVENTORY','RESOLVE_VARIANCE',
  'PRODUCE','EDIT_RECIPE',
  'REQUEST_PURCHASE','APPROVE_PURCHASE','PLACE_ORDER','RECEIVE_GOODS','MANAGE_SUPPLIERS',
  'RECORD_EXPENSE','VIEW_FINANCES','CLOSE_DAY','REOPEN_DAY',
  'VIEW_DASHBOARD','MANAGE_CATALOG','MANAGE_LOCATIONS','MANAGE_TEAM','VIEW_AUDIT_LOG'
);

create table public.user_capabilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  capability public.capability not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  -- Une révocation sans date d'octroi antérieure n'a pas de sens.
  constraint revocation_after_grant check (revoked_at is null or revoked_at >= granted_at)
);

-- Un seul accord ACTIF par capacité et par personne : sinon retirer un
-- droit demanderait de révoquer deux lignes, et on en oublierait une.
create unique index user_capabilities_active
  on public.user_capabilities (user_id, capability)
  where revoked_at is null;

create index user_capabilities_user on public.user_capabilities (user_id);
create index user_capabilities_org  on public.user_capabilities (organization_id);

-- ---------------------------------------------------------------------
-- 3. LE PRÉDICAT
--
-- `security definer` est obligatoire : sans lui, la lecture de
-- `user_capabilities` depuis une politique repasserait par RLS, qui
-- appelle cette même fonction — et la récursion casse toutes les
-- lectures. `search_path` figé : un schéma placé devant `public`
-- détournerait sinon la table interrogée.
--
-- Son `execute` RESTE accordé à anon et authenticated. Les expressions
-- de politique sont évaluées avec les privilèges de l'appelant : le
-- révoquer ici couperait l'accès à toute la base.
-- ---------------------------------------------------------------------

create or replace function public.has_capability(c public.capability)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_capabilities
    where user_id = auth.uid()
      and capability = c
      and revoked_at is null
  )
$$;

revoke execute on function public.has_capability(public.capability) from public;
grant  execute on function public.has_capability(public.capability) to anon, authenticated;

-- Les helpers de politique existants gardent eux aussi leur execute.
grant execute on function public.current_org_id() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. BACKFILL — personne ne perd d'accès aujourd'hui
--
-- Les capacités initiales sont exactement celles que le rôle donnait
-- hier. La différence est qu'elles sont désormais des données : le
-- manager peut en ajouter et en retirer sans toucher au schéma.
-- ---------------------------------------------------------------------

insert into public.user_capabilities (organization_id, user_id, capability, granted_by, granted_at)
select p.organization_id, p.id, c.capability, p.id, now()
from public.profiles p
cross join lateral (
  select unnest(
    case p.post
      when 'OWNER' then enum_range(null::public.capability)
      when 'MANAGER' then array[
        'SELL','VOID_SALE','MANAGE_CASH_SESSION','VIEW_ALL_SALES',
        'VIEW_STOCK','RECORD_WASTE','TRANSFER_STOCK','COUNT_INVENTORY','RESOLVE_VARIANCE',
        'PRODUCE','EDIT_RECIPE',
        'REQUEST_PURCHASE','APPROVE_PURCHASE','PLACE_ORDER','RECEIVE_GOODS','MANAGE_SUPPLIERS',
        'RECORD_EXPENSE','VIEW_FINANCES','CLOSE_DAY',
        'VIEW_DASHBOARD','MANAGE_CATALOG','MANAGE_LOCATIONS','MANAGE_TEAM','VIEW_AUDIT_LOG'
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
  ) as capability
) c
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. RLS SUR LA TABLE DES ACCORDS
--
-- Chacun voit ses propres accès — c'est ce que l'écran Profil affiche.
-- Seul MANAGE_TEAM voit et modifie ceux des autres.
-- ---------------------------------------------------------------------

alter table public.user_capabilities enable row level security;

create policy user_capabilities_read on public.user_capabilities
  for select to authenticated
  using (user_id = (select auth.uid())
         or (organization_id = (select public.current_org_id())
             and (select public.has_capability('MANAGE_TEAM'))));

create policy user_capabilities_grant on public.user_capabilities
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('MANAGE_TEAM'))
              and granted_by = (select auth.uid()));

-- On ne supprime pas un accord : on le révoque en datant sa fin.
-- Sans cela, « qui avait le droit le 12 août ? » redeviendrait insoluble.
create policy user_capabilities_revoke on public.user_capabilities
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_TEAM')))
  with check (revoked_at is not null and revoked_by = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 6. LES POLITIQUES — de `has_role` à `has_capability`
--
-- Le remplacement n'est pas mécanique : une politique qui listait
-- OWNER, MANAGER, PROCUREMENT ne demandait pas « être approvisionneur »
-- mais « pouvoir toucher au catalogue ». C'est cette intention qui est
-- écrite ici, et elle est maintenant délégable à n'importe qui.
-- ---------------------------------------------------------------------

-- profiles ------------------------------------------------------------
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('MANAGE_TEAM')));
create policy profiles_update on public.profiles
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_TEAM')))
  with check (organization_id = (select public.current_org_id()));
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_TEAM')));

-- items ---------------------------------------------------------------
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_insert on public.items
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('MANAGE_CATALOG')));
create policy items_update on public.items
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_CATALOG')))
  with check (organization_id = (select public.current_org_id()));
create policy items_delete on public.items
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_CATALOG')));

-- suppliers -----------------------------------------------------------
drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('MANAGE_SUPPLIERS')));
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_SUPPLIERS')))
  with check (organization_id = (select public.current_org_id()));
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_SUPPLIERS')));

-- recettes ------------------------------------------------------------
drop policy if exists recipes_insert on public.recipes;
drop policy if exists recipes_update on public.recipes;
drop policy if exists recipes_delete on public.recipes;
create policy recipes_insert on public.recipes
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('EDIT_RECIPE')));
create policy recipes_update on public.recipes
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('EDIT_RECIPE')))
  with check (organization_id = (select public.current_org_id()));
create policy recipes_delete on public.recipes
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('EDIT_RECIPE')));

drop policy if exists recipe_versions_insert on public.recipe_versions;
drop policy if exists recipe_versions_update on public.recipe_versions;
create policy recipe_versions_insert on public.recipe_versions
  for insert to authenticated
  with check ((select public.has_capability('EDIT_RECIPE')));
-- RULE-005 : une version gelée ne se réécrit pas, quelle que soit la capacité.
create policy recipe_versions_update on public.recipe_versions
  for update to authenticated
  using (frozen = false and (select public.has_capability('EDIT_RECIPE')))
  with check (frozen = false);

drop policy if exists recipe_ingredients_insert on public.recipe_ingredients;
drop policy if exists recipe_ingredients_update on public.recipe_ingredients;
drop policy if exists recipe_ingredients_delete on public.recipe_ingredients;
create policy recipe_ingredients_insert on public.recipe_ingredients
  for insert to authenticated
  with check ((select public.has_capability('EDIT_RECIPE')));
create policy recipe_ingredients_update on public.recipe_ingredients
  for update to authenticated
  using ((select public.has_capability('EDIT_RECIPE')));
create policy recipe_ingredients_delete on public.recipe_ingredients
  for delete to authenticated
  using ((select public.has_capability('EDIT_RECIPE')));

-- caisse --------------------------------------------------------------
-- Ouvrir et fermer SA caisse demande la capacité ; toucher à celle d'un
-- autre demande de pouvoir clôturer la journée. L'ancienne politique
-- laissait n'importe quel vendeur ouvrir une session sans condition.
drop policy if exists cash_sessions_insert on public.cash_sessions;
drop policy if exists cash_sessions_update on public.cash_sessions;
drop policy if exists cash_sessions_read on public.cash_sessions;
create policy cash_sessions_read on public.cash_sessions
  for select
  using (organization_id = (select public.current_org_id())
         and (seller_id = (select auth.uid())
              or (select public.has_capability('VIEW_FINANCES'))));
create policy cash_sessions_insert on public.cash_sessions
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and ((seller_id = (select auth.uid())
                    and (select public.has_capability('MANAGE_CASH_SESSION')))
                   or (select public.has_capability('CLOSE_DAY'))));
create policy cash_sessions_update on public.cash_sessions
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and ((seller_id = (select auth.uid())
               and (select public.has_capability('MANAGE_CASH_SESSION')))
              or (select public.has_capability('CLOSE_DAY'))))
  with check (organization_id = (select public.current_org_id()));

-- approvisionnement ---------------------------------------------------
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
drop policy if exists purchase_orders_delete_draft on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('REQUEST_PURCHASE')));
create policy purchase_orders_update on public.purchase_orders
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and ((select public.has_capability('APPROVE_PURCHASE'))
              or (select public.has_capability('PLACE_ORDER'))
              or (select public.has_capability('RECEIVE_GOODS'))))
  with check (organization_id = (select public.current_org_id()));
create policy purchase_orders_delete_draft on public.purchase_orders
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and status = 'DRAFT'
         and (select public.has_capability('REQUEST_PURCHASE')));

drop policy if exists purchases_insert on public.purchases;
drop policy if exists purchases_update on public.purchases;
create policy purchases_insert on public.purchases
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('RECEIVE_GOODS')));
create policy purchases_update on public.purchases
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('RECEIVE_GOODS')))
  with check (organization_id = (select public.current_org_id()));

-- inventaire ----------------------------------------------------------
-- La politique de 0006 n'exigeait que l'appartenance à l'organisation :
-- tout compte authentifié pouvait ouvrir un comptage.
drop policy if exists counts_insert on public.inventory_counts;
drop policy if exists counts_update on public.inventory_counts;
create policy counts_insert on public.inventory_counts
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('COUNT_INVENTORY')));
create policy counts_update on public.inventory_counts
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('COUNT_INVENTORY')))
  with check (organization_id = (select public.current_org_id()));

-- ventes --------------------------------------------------------------
drop policy if exists sales_read on public.sales;
drop policy if exists sales_insert on public.sales;
drop policy if exists sales_void on public.sales;
create policy sales_read on public.sales
  for select
  using (organization_id = (select public.current_org_id())
         and (seller_id = (select auth.uid())
              or (select public.has_capability('VIEW_ALL_SALES'))));
create policy sales_insert on public.sales
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and seller_id = (select auth.uid())
              and (select public.has_capability('SELL')));
create policy sales_void on public.sales
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('VOID_SALE')))
  with check (status in ('VOIDED','REFUNDED') and void_reason is not null);

-- production ----------------------------------------------------------
drop policy if exists batches_insert on public.production_batches;
create policy batches_insert on public.production_batches
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('PRODUCE')));

-- dépenses et pertes --------------------------------------------------
drop policy if exists expenses_insert on public.expenses;
drop policy if exists waste_insert on public.waste_events;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and user_id = (select auth.uid())
              and (select public.has_capability('RECORD_EXPENSE')));
create policy waste_insert on public.waste_events
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and user_id = (select auth.uid())
              and (select public.has_capability('RECORD_WASTE')));

-- journal -------------------------------------------------------------
drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events
  for select
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('VIEW_AUDIT_LOG')));

-- règles de notification ----------------------------------------------
drop policy if exists notif_rules_insert on public.notification_rules;
drop policy if exists notif_rules_update on public.notification_rules;
drop policy if exists notif_rules_delete on public.notification_rules;
create policy notif_rules_insert on public.notification_rules
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_capability('MANAGE_TEAM')));
create policy notif_rules_update on public.notification_rules
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_TEAM')))
  with check (organization_id = (select public.current_org_id()));
create policy notif_rules_delete on public.notification_rules
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_capability('MANAGE_TEAM')));

-- Une alerte s'adresse à qui peut y répondre, pas à un rôle. La colonne
-- `recipient_roles` doit disparaître avant qu'on puisse supprimer le type
-- `user_role` : un type encore référencé par une colonne ne se drope pas.
alter table public.notification_rules
  add column if not exists recipient_capabilities public.capability[] not null default '{}';
alter table public.notification_rules drop column if exists recipient_roles;

-- ---------------------------------------------------------------------
-- 7. LES FONCTIONS TRANSACTIONNELLES
--
-- Chaque garde `if v_role not in (...)` devient une garde de capacité.
-- Le message d'erreur change aussi de voix : il parle à la personne, pas
-- de son rôle — c'est elle qui le lira dans l'application.
--
-- `request_purchase` n'avait AUCUNE garde : elle lisait le rôle sans
-- jamais le vérifier. N'importe quel compte authentifié pouvait ouvrir
-- une demande d'achat. Elle en a une désormais.
-- ---------------------------------------------------------------------

create or replace function public.complete_sale(
  p_event_id uuid,
  p_site_id uuid,
  p_location_id uuid,
  p_cash_session_id uuid,
  p_payment_method text,
  p_amount_received numeric,
  p_lines jsonb,
  p_created_at_local timestamptz,
  p_device_id text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_user uuid := auth.uid();
  v_post public.user_post;
  v_sale_id uuid;
  v_existing uuid;
  v_number bigint;
  v_total numeric := 0;
  v_cogs numeric := 0;
  v_line jsonb;
  v_user_name text;
  v_item_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_item public.items%rowtype;
  v_version uuid;
  v_ingredients int;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'SALE_COMPLETED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;

  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('SELL') then
    raise exception 'Vous n''avez pas l''autorisation d''enregistrer une vente.'
      using errcode = '42501';
  end if;

  -- Totaux : le coût d'un produit à la commande se dérive si le comptoir
  -- ne l'a pas figé lui-même.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty     := (v_line->>'quantity')::numeric;
    select * into v_item from public.items where id = v_item_id;

    v_unit_cost := coalesce(nullif(v_line->>'unit_cost','')::numeric, 0);
    if v_unit_cost <= 0 and v_item.production_mode = 'MADE_TO_ORDER' then
      v_unit_cost := public.made_to_order_unit_cost(v_item_id);
    end if;

    v_total := v_total + v_qty * (v_line->>'unit_price')::numeric;
    v_cogs  := v_cogs  + v_qty * v_unit_cost;
  end loop;

  select coalesce(max(number), 0) + 1 into v_number
    from public.sales where organization_id = v_org;

  insert into public.sales (
    organization_id, site_id, location_id, cash_session_id, seller_id,
    number, total, cogs, payment_method, amount_received, status, created_at
  ) values (
    v_org, p_site_id, p_location_id, p_cash_session_id, v_user,
    v_number, v_total, v_cogs, p_payment_method, p_amount_received, 'COMPLETED',
    coalesce(p_created_at_local, now())
  ) returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty     := (v_line->>'quantity')::numeric;
    select * into v_item from public.items where id = v_item_id;

    v_unit_cost := coalesce(nullif(v_line->>'unit_cost','')::numeric, 0);
    if v_unit_cost <= 0 and v_item.production_mode = 'MADE_TO_ORDER' then
      v_unit_cost := public.made_to_order_unit_cost(v_item_id);
    end if;

    insert into public.sale_lines (sale_id, item_id, name, quantity, unit_price, unit_cost)
    values (v_sale_id, v_item_id, v_line->>'name', v_qty,
            (v_line->>'unit_price')::numeric, v_unit_cost);

    v_ingredients := 0;
    if v_item.production_mode = 'MADE_TO_ORDER' then
      v_version := public.current_recipe_version(v_item_id);

      -- §27-B : la consommation est déduite ici, pas dans un batch.
      insert into public.stock_movements (
        organization_id, site_id, location_id, item_id, quantity, unit,
        movement_type, reference_type, reference_id, user_id, device_id
      )
      select v_org, p_site_id, p_location_id, ri.item_id,
             -public.convert_qty(ri.quantity, ri.unit, ing.unit) * v_qty,
             ing.unit, 'PRODUCTION_CONSUMPTION', 'Sale', v_sale_id, v_user, p_device_id
        from public.recipe_ingredients ri
        join public.items ing on ing.id = ri.item_id
       where ri.recipe_version_id = v_version;

      get diagnostics v_ingredients = row_count;
    end if;

    if v_ingredients = 0 then
      insert into public.stock_movements (
        organization_id, site_id, location_id, item_id, quantity, unit,
        movement_type, reference_type, reference_id, user_id, device_id
      )
      select v_org, p_site_id, p_location_id, v_item_id, -v_qty, i.unit,
             'SALE', 'Sale', v_sale_id, v_user, p_device_id
        from public.items i where i.id = v_item_id;
    end if;
  end loop;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'SALE_COMPLETED', 'Sale', v_sale_id,
    v_user, p_device_id,
    jsonb_build_object('total', v_total, 'cogs', v_cogs, 'lines', p_lines),
    coalesce(p_created_at_local, now())
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference, device_id
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Vente #%s — %s FCFA', v_number, v_total),
    format('%s ligne(s) · %s', jsonb_array_length(p_lines), p_payment_method),
    format('sale:%s', v_number), p_device_id
  );

  return v_sale_id;
end;
$$;

create or replace function public.void_sale(
  p_event_id uuid,
  p_sale_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_sale public.sales%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : un motif est obligatoire';
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;

  if not public.has_capability('VOID_SALE') then
    raise exception 'Vous n''avez pas l''autorisation d''annuler une vente.'
      using errcode = '42501';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and organization_id = v_org;
  if v_sale.id is null then
    raise exception 'Vente introuvable';
  end if;
  if v_sale.status <> 'COMPLETED' then
    raise exception 'Vente déjà annulée ou remboursée';
  end if;

  update public.sales
     set status = 'VOIDED', void_reason = p_reason, voided_by = v_user
   where id = p_sale_id;

  -- Miroir exact des mouvements de la vente : on inverse ce qui a bougé.
  insert into public.stock_movements (
    organization_id, site_id, location_id, item_id, quantity, unit,
    movement_type, reference_type, reference_id, user_id
  )
  select v_org, m.site_id, m.location_id, m.item_id, -m.quantity, m.unit,
         'RETURN', 'SaleVoid', p_sale_id, v_user
    from public.stock_movements m
   where m.reference_type = 'Sale' and m.reference_id = p_sale_id;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, v_sale.site_id, 'SALE_CANCELLED', 'Sale', p_sale_id,
    v_user, jsonb_build_object('reason', p_reason), now()
  );

  insert into public.audit_events (organization_id, user_id, user_name, post, action, detail, reference)
  values (v_org, v_user, v_user_name, v_post,
          format('Annulation vente #%s', v_sale.number),
          format('motif : %s', p_reason), format('sale:%s', v_sale.number));
end;
$$;

create or replace function public.recommended_production(
  p_site_id uuid,
  p_horizon_hours int default 12,
  p_lookback_days int default 14
) returns table (
  item_id uuid,
  name text,
  unit public.unit_code,
  sold_per_day numeric,
  on_hand numeric,
  cover_hours numeric,
  recommended_quantity numeric,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid; v_post public.user_post;
begin
  select organization_id, post into v_org, v_post
    from public.profiles where id = auth.uid();

  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;
  if not public.has_capability('PRODUCE') then
    raise exception 'Vous n''avez pas l''autorisation de consulter la production recommandée.'
      using errcode = '42501';
  end if;

  return query
  with sold as (
    select sl.item_id,
           sum(sl.quantity)                                   as qty,
           count(distinct (s.created_at at time zone o.timezone)::date) as active_days
      from public.sale_lines sl
      join public.sales s on s.id = sl.sale_id
      join public.organizations o on o.id = s.organization_id
     where s.organization_id = v_org
       and s.site_id = p_site_id
       and s.status = 'COMPLETED'
       and s.created_at >= now() - make_interval(days => greatest(p_lookback_days, 1))
     group by sl.item_id
  ),
  stock as (
    select m.item_id, sum(public.convert_qty(m.quantity, m.unit, i.unit)) as qty
      from public.stock_movements m
      join public.items i on i.id = m.item_id
     where m.organization_id = v_org and m.site_id = p_site_id
     group by m.item_id
  )
  select
    i.id,
    i.name,
    i.unit,
    round(coalesce(sold.qty, 0) / greatest(coalesce(sold.active_days, 0), 1), 2),
    round(coalesce(stock.qty, 0), 2),
    case when coalesce(sold.qty, 0) = 0 then null
         else round(coalesce(stock.qty, 0)
                    / (coalesce(sold.qty, 0) / greatest(coalesce(sold.active_days, 0), 1))
                    * 24, 1)
    end,
    greatest(
      ceil(
        coalesce(sold.qty, 0) / greatest(coalesce(sold.active_days, 0), 1)
          * greatest(p_horizon_hours, 1) / 24.0
        + coalesce(i.minimum_stock, 0)
        - coalesce(stock.qty, 0)
      ), 0),
    case
      when coalesce(sold.qty, 0) = 0 then 'Aucune vente sur la période — rien à anticiper'
      when coalesce(stock.qty, 0) <= 0 then 'Rupture au comptoir'
      when coalesce(stock.qty, 0) < coalesce(i.minimum_stock, 0) then 'Sous le minimum'
      else format('%s vendus par jour en moyenne',
                  round(coalesce(sold.qty, 0) / greatest(coalesce(sold.active_days, 0), 1), 1))
    end
  from public.items i
  left join sold  on sold.item_id = i.id
  left join stock on stock.item_id = i.id
  where i.organization_id = v_org
    and i.kind = 'FINISHED'
    -- Un produit monté à la commande ne se prépare pas d'avance : ce sont
    -- ses ingrédients qu'il faut avoir, pas lui.
    and i.production_mode = 'BATCH'
    and i.active
  order by 7 desc, 4 desc;
end;
$$;

create or replace function receive_goods(
  p_event_id uuid,
  p_site_id uuid,
  p_location_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,           -- [{item_id, quantity, unit, unit_price}]
  p_transport_cost numeric,
  p_payment_method text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_purchase_id uuid; v_line jsonb; v_goods numeric := 0;
begin
  select entity_id into v_purchase_id from domain_events
    where id = p_event_id and event_type = 'GOODS_RECEIVED';
  if v_purchase_id is not null then
    return v_purchase_id;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from profiles where id = v_user;

  if not public.has_capability('RECEIVE_GOODS') then
    raise exception 'Vous n''avez pas l''autorisation de réceptionner une livraison.'
      using errcode = '42501';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_goods := v_goods + (v_line->>'quantity')::numeric * (v_line->>'unit_price')::numeric;
  end loop;

  insert into purchases (
    organization_id, site_id, supplier_id, location_id,
    transport_cost, total, payment_method, created_by, received_at
  ) values (
    v_org, p_site_id, p_supplier_id, p_location_id,
    coalesce(p_transport_cost, 0), v_goods + coalesce(p_transport_cost, 0),
    p_payment_method, v_user, now()
  ) returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into purchase_lines (purchase_id, item_id, quantity, unit, actual_unit_price)
    values (v_purchase_id, (v_line->>'item_id')::uuid, (v_line->>'quantity')::numeric,
            (v_line->>'unit')::unit_code, (v_line->>'unit_price')::numeric);

    insert into stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id
    ) values (
      v_org, p_site_id, p_location_id, (v_line->>'item_id')::uuid,
      (v_line->>'quantity')::numeric, (v_line->>'unit')::unit_code,
      'PURCHASE_RECEIPT', 'GoodsReceipt', v_purchase_id, v_user
    );

    perform apply_weighted_average_cost(
      (v_line->>'item_id')::uuid,
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric
    );

    insert into price_observations (organization_id, item_id, supplier_id, unit_price)
    values (v_org, (v_line->>'item_id')::uuid, p_supplier_id, (v_line->>'unit_price')::numeric);
  end loop;

  -- §39 : la marchandise entre en stock, le transport est une charge directe.
  insert into expenses (
    organization_id, site_id, amount, category, description,
    supplier_id, payment_method, user_id
  ) values (
    v_org, p_site_id, v_goods + coalesce(p_transport_cost, 0), 'MATIERE',
    'Réception fournisseur', p_supplier_id, p_payment_method, v_user
  );

  insert into domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'GOODS_RECEIVED', 'GoodsReceipt', v_purchase_id,
    v_user, jsonb_build_object('lines', p_lines, 'transport', p_transport_cost), now()
  );

  insert into audit_events (organization_id, user_id, user_name, post, action, detail)
  values (v_org, v_user, v_user_name, v_post, 'Réception marchandise',
          format('%s ligne(s) · %s FCFA', jsonb_array_length(p_lines),
                 v_goods + coalesce(p_transport_cost, 0)));

  return v_purchase_id;
end;
$$;

create or replace function public.approve_purchase_request(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_po public.purchase_orders%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;

  if not public.has_capability('APPROVE_PURCHASE') then
    raise exception 'Vous n''avez pas l''autorisation d''approuver une demande d''achat.'
      using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders
    where id = p_purchase_order_id and organization_id = v_org;
  if v_po.id is null then
    raise exception 'Demande introuvable';
  end if;

  update public.purchase_orders
     set status = 'APPROVED', approved_by = v_user, approved_at = now(),
         comment = coalesce(p_comment, comment)
   where id = p_purchase_order_id;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, v_po.site_id, 'PURCHASE_ORDER_APPROVED', 'PurchaseRequest',
    p_purchase_order_id, v_user, jsonb_build_object('comment', p_comment), now()
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Approbation demande %s', v_po.po_number), p_comment,
    format('purchase_request:%s', v_po.po_number)
  );
end;
$$;

create or replace function public.reject_purchase_request(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_po public.purchase_orders%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : un refus doit dire pourquoi';
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;

  if not public.has_capability('APPROVE_PURCHASE') then
    raise exception 'Vous n''avez pas l''autorisation de refuser une demande d''achat.'
      using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders
    where id = p_purchase_order_id and organization_id = v_org;
  if v_po.id is null then
    raise exception 'Demande introuvable';
  end if;

  update public.purchase_orders
     set status = 'REJECTED', rejected_by = v_user, rejected_at = now(),
         rejection_reason = p_reason
   where id = p_purchase_order_id;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, v_po.site_id, 'PURCHASE_ORDER_REJECTED', 'PurchaseRequest',
    p_purchase_order_id, v_user, jsonb_build_object('reason', p_reason), now()
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Refus demande %s', v_po.po_number),
    format('motif : %s', p_reason),
    format('purchase_request:%s', v_po.po_number)
  );
end;
$$;

create or replace function public.place_purchase_order(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_supplier_id uuid default null,
  p_expected_delivery_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_po public.purchase_orders%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;

  if not public.has_capability('PLACE_ORDER') then
    raise exception 'Vous n''avez pas l''autorisation de passer une commande.'
      using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders
    where id = p_purchase_order_id and organization_id = v_org;
  if v_po.id is null then
    raise exception 'Demande introuvable';
  end if;

  update public.purchase_orders
     set status = 'PURCHASING',
         supplier_id = coalesce(p_supplier_id, supplier_id),
         ordered_at = now(),
         expected_delivery_at = coalesce(
           p_expected_delivery_at,
           now() + make_interval(days => coalesce(
             (select lead_time_days from public.suppliers
               where id = coalesce(p_supplier_id, v_po.supplier_id)), 1)))
   where id = p_purchase_order_id;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, v_po.site_id, 'PURCHASE_ORDER_PLACED', 'PurchaseOrder',
    p_purchase_order_id, v_user,
    jsonb_build_object('supplier_id', coalesce(p_supplier_id, v_po.supplier_id),
                       'expected_delivery_at', p_expected_delivery_at), now()
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Commande passée %s', v_po.po_number), null,
    format('purchase_order:%s', v_po.po_number)
  );
end;
$$;

create or replace function public.receive_purchase_order(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_location_id uuid,
  p_lines jsonb,            -- [{item_id, quantity, unit, unit_price}]
  p_transport_cost numeric default 0,
  p_payment_method text default 'CASH'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_po public.purchase_orders%rowtype;
  v_purchase_id uuid; v_line jsonb; v_goods numeric := 0; v_remaining numeric;
begin
  select entity_id into v_purchase_id from public.domain_events
    where id = p_event_id and event_type = 'GOODS_RECEIVED';
  if v_purchase_id is not null then
    return v_purchase_id;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;

  if not public.has_capability('RECEIVE_GOODS') then
    raise exception 'Vous n''avez pas l''autorisation de réceptionner une commande.'
      using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders
    where id = p_purchase_order_id and organization_id = v_org;
  if v_po.id is null then
    raise exception 'Commande introuvable';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_goods := v_goods + (v_line->>'quantity')::numeric * (v_line->>'unit_price')::numeric;
  end loop;

  insert into public.purchases (
    organization_id, site_id, purchase_order_id, supplier_id, location_id,
    transport_cost, total, payment_method, created_by, received_at
  ) values (
    v_org, v_po.site_id, p_purchase_order_id, v_po.supplier_id, p_location_id,
    coalesce(p_transport_cost, 0), v_goods + coalesce(p_transport_cost, 0),
    p_payment_method, v_user, now()
  ) returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.purchase_lines (
      purchase_id, item_id, quantity, unit, expected_unit_price, actual_unit_price
    )
    select v_purchase_id, (v_line->>'item_id')::uuid, (v_line->>'quantity')::numeric,
           (v_line->>'unit')::public.unit_code,
           pol.expected_unit_price, (v_line->>'unit_price')::numeric
      from public.purchase_order_lines pol
     where pol.purchase_order_id = p_purchase_order_id
       and pol.item_id = (v_line->>'item_id')::uuid
     limit 1;

    -- Article livré qui n'était pas commandé : on l'entre quand même, la
    -- marchandise est là. L'écart se lira dans la comparaison.
    if not found then
      insert into public.purchase_lines (purchase_id, item_id, quantity, unit, actual_unit_price)
      values (v_purchase_id, (v_line->>'item_id')::uuid, (v_line->>'quantity')::numeric,
              (v_line->>'unit')::public.unit_code, (v_line->>'unit_price')::numeric);
    end if;

    insert into public.stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id
    ) values (
      v_org, v_po.site_id, p_location_id, (v_line->>'item_id')::uuid,
      (v_line->>'quantity')::numeric, (v_line->>'unit')::public.unit_code,
      'PURCHASE_RECEIPT', 'GoodsReceipt', v_purchase_id, v_user
    );

    perform public.apply_weighted_average_cost(
      (v_line->>'item_id')::uuid,
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric
    );

    insert into public.price_observations (organization_id, item_id, supplier_id, unit_price)
    values (v_org, (v_line->>'item_id')::uuid, v_po.supplier_id, (v_line->>'unit_price')::numeric);
  end loop;

  insert into public.expenses (
    organization_id, site_id, amount, category, description,
    supplier_id, payment_method, user_id
  ) values (
    v_org, v_po.site_id, v_goods + coalesce(p_transport_cost, 0), 'MATIERE',
    format('Réception %s', v_po.po_number), v_po.supplier_id, p_payment_method, v_user
  );

  -- Reste à livrer : commandé moins déjà reçu, toutes réceptions confondues.
  select coalesce(sum(pol.quantity), 0) - coalesce((
           select sum(pl.quantity)
             from public.purchase_lines pl
             join public.purchases p on p.id = pl.purchase_id
            where p.purchase_order_id = p_purchase_order_id), 0)
    into v_remaining
    from public.purchase_order_lines pol
   where pol.purchase_order_id = p_purchase_order_id;

  update public.purchase_orders
     set status = case when v_remaining > 0 then 'PARTIALLY_RECEIVED' else 'RECEIVED' end
   where id = p_purchase_order_id
     and status in ('PURCHASING','PARTIALLY_RECEIVED');

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, v_po.site_id, 'GOODS_RECEIVED', 'GoodsReceipt', v_purchase_id,
    v_user, jsonb_build_object('purchase_order_id', p_purchase_order_id,
                               'lines', p_lines, 'transport', p_transport_cost), now()
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Réception %s', v_po.po_number),
    format('%s ligne(s) · %s FCFA', jsonb_array_length(p_lines),
           v_goods + coalesce(p_transport_cost, 0)),
    format('purchase_order:%s', v_po.po_number)
  );

  return v_purchase_id;
end;
$$;

create or replace function public.request_purchase(
  p_event_id      uuid,
  p_site_id       uuid,
  p_supplier_id   uuid,
  p_lines         jsonb,   -- [{item_id, quantity, unit, expected_unit_price}]
  p_needed_by     date default null,
  p_priority      text default 'NORMALE',
  p_justification text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_po_id uuid; v_existing uuid; v_number text; v_line jsonb; v_seq int;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'PURCHASE_REQUESTED';
  if v_existing is not null then
    return v_existing;                       -- §56 : retry réseau, pas doublon
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  -- Cette fonction lisait le rôle sans jamais le vérifier : n'importe quel
  -- compte authentifié pouvait ouvrir une demande d'achat. La garde manquait.
  if not public.has_capability('REQUEST_PURCHASE') then
    raise exception 'Vous n''avez pas l''autorisation de demander un achat.'
      using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Une demande sans article ne sert à rien';
  end if;

  select count(*) + 1 into v_seq from public.purchase_orders
    where organization_id = v_org and requested_at::date = current_date;
  v_number := 'DA-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');

  insert into public.purchase_orders (
    organization_id, site_id, po_number, supplier_id, status,
    requested_by, comment, needed_by, priority, justification
  ) values (
    v_org, p_site_id, v_number, p_supplier_id, 'PENDING_APPROVAL',
    v_user, null, p_needed_by, coalesce(p_priority, 'NORMALE'), p_justification
  ) returning id into v_po_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.purchase_order_lines (
      purchase_order_id, item_id, quantity, unit, expected_unit_price
    ) values (
      v_po_id,
      (v_line->>'item_id')::uuid,
      (v_line->>'quantity')::numeric,
      (v_line->>'unit')::public.unit_code,
      nullif(v_line->>'expected_unit_price', '')::numeric
    );
  end loop;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'PURCHASE_REQUESTED', 'PurchaseRequest', v_po_id,
    v_user, jsonb_build_object('lines', p_lines, 'needed_by', p_needed_by,
                               'priority', p_priority), now()
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Demande d''achat %s', v_number),
    format('%s article(s) · %s', jsonb_array_length(p_lines), coalesce(p_priority,'NORMALE')),
    format('purchase_request:%s', v_number)
  );

  return v_po_id;
end;
$$;
-- ---------------------------------------------------------------------
-- 8. LE TRIGGER DE CRÉATION DE COMPTE
--
-- Un nouveau compte reçoit le préréglage de son poste — un point de
-- départ, pas une règle. Le manager ajuste ensuite opération par
-- opération, et chaque ajustement laisse une trace.
-- ---------------------------------------------------------------------

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
      when 'OWNER' then enum_range(null::public.capability)
      when 'MANAGER' then array[
        'SELL','VOID_SALE','MANAGE_CASH_SESSION','VIEW_ALL_SALES',
        'VIEW_STOCK','RECORD_WASTE','TRANSFER_STOCK','COUNT_INVENTORY','RESOLVE_VARIANCE',
        'PRODUCE','EDIT_RECIPE',
        'REQUEST_PURCHASE','APPROVE_PURCHASE','PLACE_ORDER','RECEIVE_GOODS','MANAGE_SUPPLIERS',
        'RECORD_EXPENSE','VIEW_FINANCES','CLOSE_DAY',
        'VIEW_DASHBOARD','MANAGE_CATALOG','MANAGE_LOCATIONS','MANAGE_TEAM','VIEW_AUDIT_LOG'
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

-- ---------------------------------------------------------------------
-- 9. MÉNAGE
--
-- `has_role` et `current_role_name` n'ont plus d'appelant. Les laisser
-- en place, c'est laisser un chemin par lequel une politique future
-- pourrait ré-encoder un rôle en dur.
-- ---------------------------------------------------------------------

drop function if exists public.has_role(public.user_role[]);
drop function if exists public.current_role_name();
drop type if exists public.user_role;

-- ---------------------------------------------------------------------
-- 10. PRIVILÈGES
--
-- Postgres accorde EXECUTE à PUBLIC par défaut sur toute fonction : un
-- `revoke ... from anon` seul ne fait rien. On révoque de `public`, puis
-- on accorde nommément.
-- ---------------------------------------------------------------------

-- Les signatures ne sont pas écrites à la main : une signature devinée
-- produit un `revoke` qui échoue, ou pire, qui porte sur une surcharge
-- voisine et laisse la vraie fonction ouverte à PUBLIC. On les lit dans
-- le catalogue.
revoke execute on function public.handle_new_user() from public;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'complete_sale','void_sale','receive_goods','request_purchase',
        'approve_purchase_request','reject_purchase_request','place_purchase_order',
        'receive_purchase_order','recommended_production','apply_weighted_average_cost'
      )
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
