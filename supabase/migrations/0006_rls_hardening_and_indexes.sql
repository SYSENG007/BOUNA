-- =====================================================================
-- BUNA Operations — durcissement RLS et index de clés étrangères
--
-- Trois défauts relevés en base avant d'ajouter quoi que ce soit :
--   1. deux politiques laissaient écrire dans les recettes d'une AUTRE
--      organisation — le contrôle portait sur le rôle, pas sur l'organisation ;
--   2. les politiques `for all` doublonnaient les politiques `for select`,
--      ce qui fait évaluer deux expressions à chaque lecture ;
--   3. `auth.uid()` était réévalué ligne par ligne au lieu d'une fois par
--      requête.
-- Les migrations suivantes s'appuient sur cette base assainie.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FUITE D'ÉCRITURE ENTRE ORGANISATIONS
--
-- `recipe_versions_insert`, `recipe_versions_update` et
-- `recipe_ingredients_write` ne vérifiaient que le rôle. Un MANAGER de
-- l'organisation A pouvait donc insérer, modifier ou supprimer les
-- ingrédients d'une recette de l'organisation B : le rôle est le bon, mais
-- la recette ne lui appartient pas. On ajoute la clause d'organisation.
-- ---------------------------------------------------------------------

drop policy if exists recipe_versions_insert on public.recipe_versions;
create policy recipe_versions_insert on public.recipe_versions
  for insert to authenticated
  with check (
    (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))
    and recipe_id in (select id from public.recipes
                       where organization_id = (select public.current_org_id()))
  );

drop policy if exists recipe_versions_update on public.recipe_versions;
create policy recipe_versions_update on public.recipe_versions
  for update to authenticated
  using (
    frozen = false
    and (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))
    and recipe_id in (select id from public.recipes
                       where organization_id = (select public.current_org_id()))
  )
  with check (
    recipe_id in (select id from public.recipes
                   where organization_id = (select public.current_org_id()))
  );

-- Une version gelée reste intouchable, et la recette doit être la nôtre.
drop policy if exists recipe_ingredients_write on public.recipe_ingredients;

create policy recipe_ingredients_insert on public.recipe_ingredients
  for insert to authenticated
  with check (
    (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))
    and recipe_version_id in (
      select rv.id from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where r.organization_id = (select public.current_org_id())
        and rv.frozen = false)
  );

create policy recipe_ingredients_update on public.recipe_ingredients
  for update to authenticated
  using (
    (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))
    and recipe_version_id in (
      select rv.id from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where r.organization_id = (select public.current_org_id())
        and rv.frozen = false)
  )
  with check (
    recipe_version_id in (
      select rv.id from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where r.organization_id = (select public.current_org_id()))
  );

create policy recipe_ingredients_delete on public.recipe_ingredients
  for delete to authenticated
  using (
    (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))
    and recipe_version_id in (
      select rv.id from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where r.organization_id = (select public.current_org_id())
        and rv.frozen = false)
  );

-- ---------------------------------------------------------------------
-- 2. POLITIQUES `for all` SCINDÉES
--
-- Une politique `for all` couvre aussi le SELECT. Sur les dix tables qui
-- portaient déjà une politique de lecture, chaque lecture évaluait donc
-- deux expressions permissives au lieu d'une. On garde exactement les
-- mêmes droits en restreignant l'écriture à INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------

-- profiles ------------------------------------------------------------
drop policy if exists profiles_write on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));
create policy profiles_update on public.profiles
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));

-- items ---------------------------------------------------------------
drop policy if exists items_write on public.items;
create policy items_insert on public.items
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])));
create policy items_update on public.items
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));
create policy items_delete on public.items
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));

-- suppliers -----------------------------------------------------------
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])));
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));

-- recipes -------------------------------------------------------------
drop policy if exists recipes_write on public.recipes;
create policy recipes_insert on public.recipes
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));
create policy recipes_update on public.recipes
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));
create policy recipes_delete on public.recipes
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));

-- cash_sessions -------------------------------------------------------
drop policy if exists cash_sessions_write on public.cash_sessions;
create policy cash_sessions_insert on public.cash_sessions
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (seller_id = (select auth.uid())
                   or (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))));
create policy cash_sessions_update on public.cash_sessions
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (seller_id = (select auth.uid())
              or (select public.has_role(array['OWNER','MANAGER']::public.user_role[]))))
  with check (organization_id = (select public.current_org_id()));

-- purchase_orders -----------------------------------------------------
drop policy if exists purchase_orders_write on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])));
create policy purchase_orders_update on public.purchase_orders
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));
-- RULE-001 : seul un brouillon jamais soumis se supprime. Dès qu'une
-- demande est partie en approbation, elle se refuse avec un motif.
create policy purchase_orders_delete_draft on public.purchase_orders
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and status = 'DRAFT'
         and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])));

-- purchases -----------------------------------------------------------
drop policy if exists purchases_write on public.purchases;
create policy purchases_insert on public.purchases
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])));
create policy purchases_update on public.purchases
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER','PROCUREMENT']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));

-- inventory_counts ----------------------------------------------------
drop policy if exists counts_write on public.inventory_counts;
create policy counts_insert on public.inventory_counts
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()));
create policy counts_update on public.inventory_counts
  for update to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));
-- Un comptage validé fait foi ; seul un brouillon s'abandonne.
create policy counts_delete_draft on public.inventory_counts
  for delete to authenticated
  using (organization_id = (select public.current_org_id()) and status = 'DRAFT');

-- notification_rules --------------------------------------------------
drop policy if exists notif_rules_write on public.notification_rules;
create policy notif_rules_insert on public.notification_rules
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));
create policy notif_rules_update on public.notification_rules
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])))
  with check (organization_id = (select public.current_org_id()));
create policy notif_rules_delete on public.notification_rules
  for delete to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])));

-- ---------------------------------------------------------------------
-- 3. `auth.uid()` ÉVALUÉ UNE FOIS PAR REQUÊTE
--
-- Écrit tel quel, `auth.uid()` est réévalué pour chaque ligne examinée.
-- Enveloppé dans un sous-select, le planificateur le calcule une fois.
-- Sur un historique de ventes de plusieurs milliers de lignes, l'écart
-- se voit à l'écran.
-- ---------------------------------------------------------------------

drop policy if exists devices_own on public.devices;
create policy devices_own on public.devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists movements_insert on public.stock_movements;
create policy movements_insert on public.stock_movements
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and user_id = (select auth.uid()));

drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales
  for select
  using (organization_id = (select public.current_org_id())
         and (seller_id = (select auth.uid())
              or (select public.has_role(array['OWNER','MANAGER','FINANCE']::public.user_role[]))));

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and seller_id = (select auth.uid()));

drop policy if exists sales_void on public.sales;
create policy sales_void on public.sales
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and (select public.has_role(array['OWNER','MANAGER']::public.user_role[])))
  with check (status in ('VOIDED','REFUNDED') and void_reason is not null);

drop policy if exists cash_sessions_read on public.cash_sessions;
create policy cash_sessions_read on public.cash_sessions
  for select
  using (organization_id = (select public.current_org_id())
         and (seller_id = (select auth.uid())
              or (select public.has_role(array['OWNER','MANAGER','FINANCE']::public.user_role[]))));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and user_id = (select auth.uid()));

drop policy if exists waste_insert on public.waste_events;
create policy waste_insert on public.waste_events
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and user_id = (select auth.uid()));

drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists events_insert on public.domain_events;
create policy events_insert on public.domain_events
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and actor_user_id = (select auth.uid()));

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select
  using (recipient_user_id = (select auth.uid()));

drop policy if exists notifications_ack on public.notifications;
create policy notifications_ack on public.notifications
  for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 4. INDEX DE CLÉS ÉTRANGÈRES
--
-- PostgreSQL n'indexe pas les colonnes de clé étrangère. Sans index, un
-- `join` remonte en balayage séquentiel et surtout une suppression en
-- cascade verrouille la table fille entière. Toutes les politiques RLS
-- de ce schéma filtrent sur `organization_id` ou `site_id` : ce sont
-- exactement ces colonnes.
-- ---------------------------------------------------------------------

create index if not exists idx_sites_organization           on public.sites (organization_id);
create index if not exists idx_stock_locations_site         on public.stock_locations (site_id);
create index if not exists idx_profiles_organization        on public.profiles (organization_id);
create index if not exists idx_profiles_site                on public.profiles (site_id);
create index if not exists idx_profiles_org_role            on public.profiles (organization_id, role);
create index if not exists idx_suppliers_organization       on public.suppliers (organization_id);
create index if not exists idx_items_organization           on public.items (organization_id);
create index if not exists idx_items_preferred_supplier     on public.items (preferred_supplier_id);
create index if not exists idx_recipes_organization         on public.recipes (organization_id);
create index if not exists idx_recipes_item                 on public.recipes (item_id);
create index if not exists idx_recipe_ingredients_version   on public.recipe_ingredients (recipe_version_id);
create index if not exists idx_recipe_ingredients_item      on public.recipe_ingredients (item_id);
create index if not exists idx_stock_movements_site         on public.stock_movements (site_id);
create index if not exists idx_stock_movements_location     on public.stock_movements (location_id);
create index if not exists idx_stock_movements_user         on public.stock_movements (user_id);
create index if not exists idx_purchase_orders_site         on public.purchase_orders (site_id);
create index if not exists idx_purchase_orders_supplier     on public.purchase_orders (supplier_id);
create index if not exists idx_purchase_orders_requested_by on public.purchase_orders (requested_by);
create index if not exists idx_purchase_orders_approved_by  on public.purchase_orders (approved_by);
create index if not exists idx_po_lines_order               on public.purchase_order_lines (purchase_order_id);
create index if not exists idx_po_lines_item                on public.purchase_order_lines (item_id);
create index if not exists idx_purchases_organization       on public.purchases (organization_id);
create index if not exists idx_purchases_site               on public.purchases (site_id);
create index if not exists idx_purchases_order              on public.purchases (purchase_order_id);
create index if not exists idx_purchases_supplier           on public.purchases (supplier_id);
create index if not exists idx_purchases_location           on public.purchases (location_id);
create index if not exists idx_purchases_created_by         on public.purchases (created_by);
create index if not exists idx_purchase_lines_purchase      on public.purchase_lines (purchase_id);
create index if not exists idx_purchase_lines_item          on public.purchase_lines (item_id);
create index if not exists idx_price_observations_org       on public.price_observations (organization_id);
create index if not exists idx_price_observations_supplier  on public.price_observations (supplier_id);
create index if not exists idx_batches_site                 on public.production_batches (site_id);
create index if not exists idx_batches_item                 on public.production_batches (item_id);
create index if not exists idx_batches_recipe_version       on public.production_batches (recipe_version_id);
create index if not exists idx_batches_preparer             on public.production_batches (preparer_id);
create index if not exists idx_batches_location             on public.production_batches (location_id);
create index if not exists idx_cash_sessions_organization   on public.cash_sessions (organization_id);
create index if not exists idx_cash_sessions_site           on public.cash_sessions (site_id);
create index if not exists idx_cash_sessions_seller         on public.cash_sessions (seller_id);
create index if not exists idx_sales_site                   on public.sales (site_id);
create index if not exists idx_sales_location               on public.sales (location_id);
create index if not exists idx_sales_cash_session           on public.sales (cash_session_id);
create index if not exists idx_sales_seller                 on public.sales (seller_id);
create index if not exists idx_sales_voided_by              on public.sales (voided_by);
create index if not exists idx_sale_lines_sale              on public.sale_lines (sale_id);
create index if not exists idx_sale_lines_item              on public.sale_lines (item_id);
create index if not exists idx_expenses_organization        on public.expenses (organization_id);
create index if not exists idx_expenses_site                on public.expenses (site_id);
create index if not exists idx_expenses_supplier            on public.expenses (supplier_id);
create index if not exists idx_expenses_user                on public.expenses (user_id);
create index if not exists idx_waste_events_organization    on public.waste_events (organization_id);
create index if not exists idx_waste_events_item            on public.waste_events (item_id);
create index if not exists idx_waste_events_location        on public.waste_events (location_id);
create index if not exists idx_waste_events_user            on public.waste_events (user_id);
create index if not exists idx_inventory_counts_org         on public.inventory_counts (organization_id);
create index if not exists idx_inventory_counts_location    on public.inventory_counts (location_id);
create index if not exists idx_inventory_counts_user        on public.inventory_counts (user_id);
create index if not exists idx_count_lines_count            on public.inventory_count_lines (inventory_count_id);
create index if not exists idx_count_lines_item             on public.inventory_count_lines (item_id);
create index if not exists idx_domain_events_site           on public.domain_events (site_id);
create index if not exists idx_domain_events_actor          on public.domain_events (actor_user_id);
create index if not exists idx_audit_events_user            on public.audit_events (user_id);
create index if not exists idx_notification_rules_org       on public.notification_rules (organization_id);
create index if not exists idx_notifications_organization   on public.notifications (organization_id);
create index if not exists idx_notifications_rule           on public.notifications (rule_id);
create index if not exists idx_notifications_event          on public.notifications (event_id);
create index if not exists idx_push_subscriptions_user      on public.push_subscriptions (user_id);

-- Ventes du jour par site : c'est la requête du cockpit et du moteur de
-- règles, elle tourne toutes les cinq minutes.
create index if not exists idx_sales_site_created on public.sales (site_id, created_at desc)
  where status = 'COMPLETED';
