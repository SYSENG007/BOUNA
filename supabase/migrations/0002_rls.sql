-- =====================================================================
-- BUNA Operations — Row Level Security (§73, §97)
-- Le client peut créer des événements, mais le backend reste autoritaire.
-- Toute permission critique est revalidée ici, jamais seulement dans l'UI.
-- =====================================================================

-- Organisation de l'utilisateur courant, en SECURITY DEFINER pour éviter
-- la récursion des politiques sur profiles.
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid()
$$;

create or replace function current_role_name()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function has_role(roles user_role[])
returns boolean
language sql
stable
as $$
  select current_role_name() = any(roles)
$$;

-- Activation ------------------------------------------------------------

alter table organizations        enable row level security;
alter table sites                enable row level security;
alter table stock_locations      enable row level security;
alter table profiles             enable row level security;
alter table devices              enable row level security;
alter table suppliers            enable row level security;
alter table items                enable row level security;
alter table recipes              enable row level security;
alter table recipe_versions      enable row level security;
alter table recipe_ingredients   enable row level security;
alter table stock_movements      enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_lines enable row level security;
alter table purchases            enable row level security;
alter table purchase_lines       enable row level security;
alter table price_observations   enable row level security;
alter table production_batches   enable row level security;
alter table cash_sessions        enable row level security;
alter table sales                enable row level security;
alter table sale_lines           enable row level security;
alter table expenses             enable row level security;
alter table waste_events         enable row level security;
alter table inventory_counts     enable row level security;
alter table inventory_count_lines enable row level security;
alter table domain_events        enable row level security;
alter table audit_events         enable row level security;
alter table notification_rules   enable row level security;
alter table notifications        enable row level security;
alter table push_subscriptions   enable row level security;

-- Isolation par organisation --------------------------------------------

create policy org_read on organizations for select
  using (id = current_org_id());

create policy sites_read on sites for select
  using (organization_id = current_org_id());

create policy locations_read on stock_locations for select
  using (site_id in (select id from sites where organization_id = current_org_id()));

create policy profiles_read on profiles for select
  using (organization_id = current_org_id());

-- Seuls Owner et Manager gèrent les comptes (§6.1).
create policy profiles_write on profiles for all
  using (organization_id = current_org_id() and has_role(array['OWNER','MANAGER']::user_role[]))
  with check (organization_id = current_org_id());

create policy devices_own on devices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Catalogue : lecture pour tous, écriture réservée.
create policy items_read on items for select
  using (organization_id = current_org_id());

create policy items_write on items for all
  using (organization_id = current_org_id()
         and has_role(array['OWNER','MANAGER','PROCUREMENT']::user_role[]))
  with check (organization_id = current_org_id());

create policy suppliers_read on suppliers for select
  using (organization_id = current_org_id());

create policy suppliers_write on suppliers for all
  using (organization_id = current_org_id()
         and has_role(array['OWNER','MANAGER','PROCUREMENT']::user_role[]))
  with check (organization_id = current_org_id());

-- RULE-005 : les recettes ne se réécrivent pas ; on crée une version.
create policy recipes_read on recipes for select
  using (organization_id = current_org_id());

create policy recipes_write on recipes for all
  using (organization_id = current_org_id() and has_role(array['OWNER','MANAGER']::user_role[]))
  with check (organization_id = current_org_id());

create policy recipe_versions_read on recipe_versions for select
  using (recipe_id in (select id from recipes where organization_id = current_org_id()));

create policy recipe_versions_insert on recipe_versions for insert
  with check (has_role(array['OWNER','MANAGER']::user_role[]));

-- Une version gelée n'est plus modifiable, même par un Owner.
create policy recipe_versions_update on recipe_versions for update
  using (frozen = false and has_role(array['OWNER','MANAGER']::user_role[]));

create policy recipe_ingredients_read on recipe_ingredients for select
  using (recipe_version_id in (
    select rv.id from recipe_versions rv
    join recipes r on r.id = rv.recipe_id
    where r.organization_id = current_org_id()));

create policy recipe_ingredients_write on recipe_ingredients for all
  using (has_role(array['OWNER','MANAGER']::user_role[]))
  with check (has_role(array['OWNER','MANAGER']::user_role[]));

-- Mouvements de stock : insertion seule. RULE-002 — rien ne s'écrase,
-- rien ne se supprime ; une correction est un nouveau mouvement.
create policy movements_read on stock_movements for select
  using (organization_id = current_org_id());

create policy movements_insert on stock_movements for insert
  with check (organization_id = current_org_id() and user_id = auth.uid());

-- Ventes : un vendeur voit et crée les siennes ; l'encadrement voit tout.
create policy sales_read on sales for select
  using (organization_id = current_org_id()
         and (seller_id = auth.uid()
              or has_role(array['OWNER','MANAGER','FINANCE']::user_role[])));

create policy sales_insert on sales for insert
  with check (organization_id = current_org_id() and seller_id = auth.uid());

-- RULE-001 : pas de DELETE. L'annulation est un UPDATE de statut motivé,
-- réservé à ceux qui portent la responsabilité.
create policy sales_void on sales for update
  using (organization_id = current_org_id()
         and has_role(array['OWNER','MANAGER']::user_role[]))
  with check (status in ('VOIDED','REFUNDED') and void_reason is not null);

create policy sale_lines_read on sale_lines for select
  using (sale_id in (select id from sales where organization_id = current_org_id()));

create policy sale_lines_insert on sale_lines for insert
  with check (sale_id in (select id from sales where organization_id = current_org_id()));

create policy cash_sessions_read on cash_sessions for select
  using (organization_id = current_org_id()
         and (seller_id = auth.uid()
              or has_role(array['OWNER','MANAGER','FINANCE']::user_role[])));

create policy cash_sessions_write on cash_sessions for all
  using (organization_id = current_org_id()
         and (seller_id = auth.uid() or has_role(array['OWNER','MANAGER']::user_role[])))
  with check (organization_id = current_org_id());

-- Production
create policy batches_read on production_batches for select
  using (organization_id = current_org_id());

create policy batches_insert on production_batches for insert
  with check (organization_id = current_org_id()
              and has_role(array['OWNER','MANAGER','PREPARER']::user_role[]));

-- Achats & réceptions
create policy purchases_read on purchases for select
  using (organization_id = current_org_id());

create policy purchases_write on purchases for all
  using (organization_id = current_org_id()
         and has_role(array['OWNER','MANAGER','PROCUREMENT']::user_role[]))
  with check (organization_id = current_org_id());

create policy purchase_lines_all on purchase_lines for all
  using (purchase_id in (select id from purchases where organization_id = current_org_id()))
  with check (purchase_id in (select id from purchases where organization_id = current_org_id()));

create policy purchase_orders_read on purchase_orders for select
  using (organization_id = current_org_id());

create policy purchase_orders_write on purchase_orders for all
  using (organization_id = current_org_id()
         and has_role(array['OWNER','MANAGER','PROCUREMENT']::user_role[]))
  with check (organization_id = current_org_id());

create policy po_lines_all on purchase_order_lines for all
  using (purchase_order_id in (select id from purchase_orders where organization_id = current_org_id()))
  with check (purchase_order_id in (select id from purchase_orders where organization_id = current_org_id()));

create policy prices_read on price_observations for select
  using (organization_id = current_org_id());

create policy prices_insert on price_observations for insert
  with check (organization_id = current_org_id());

-- Dépenses, pertes, inventaires
create policy expenses_read on expenses for select
  using (organization_id = current_org_id());

create policy expenses_insert on expenses for insert
  with check (organization_id = current_org_id() and user_id = auth.uid());

create policy waste_read on waste_events for select
  using (organization_id = current_org_id());

create policy waste_insert on waste_events for insert
  with check (organization_id = current_org_id() and user_id = auth.uid());

create policy counts_read on inventory_counts for select
  using (organization_id = current_org_id());

create policy counts_write on inventory_counts for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

create policy count_lines_all on inventory_count_lines for all
  using (inventory_count_id in (select id from inventory_counts where organization_id = current_org_id()))
  with check (inventory_count_id in (select id from inventory_counts where organization_id = current_org_id()));

-- Événements : insertion idempotente par le client, jamais de modification.
create policy events_read on domain_events for select
  using (organization_id = current_org_id());

create policy events_insert on domain_events for insert
  with check (organization_id = current_org_id() and actor_user_id = auth.uid());

-- Audit : lecture réservée, écriture par le serveur uniquement.
-- Aucune policy INSERT/UPDATE/DELETE : seules les fonctions SECURITY DEFINER
-- et le service_role peuvent écrire ici.
create policy audit_read on audit_events for select
  using (organization_id = current_org_id()
         and has_role(array['OWNER','MANAGER','FINANCE']::user_role[]));

-- Notifications
create policy notif_rules_read on notification_rules for select
  using (organization_id = current_org_id());

create policy notif_rules_write on notification_rules for all
  using (organization_id = current_org_id() and has_role(array['OWNER','MANAGER']::user_role[]))
  with check (organization_id = current_org_id());

create policy notifications_own on notifications for select
  using (recipient_user_id = auth.uid());

create policy notifications_ack on notifications for update
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

create policy push_own on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
