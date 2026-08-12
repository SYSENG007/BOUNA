-- =====================================================================
-- BUNA Operations — schéma de référence (Sprint 0)
-- PostgreSQL / Supabase.  UUID partout, timestamps serveur, FK strictes.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------- Organisation

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'XOF',
  timezone text not null default 'Africa/Dakar',
  created_at timestamptz not null default now()
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create type location_type as enum ('CENTRAL','KITCHEN','FRIDGE','POS','RESERVE');

create table stock_locations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  type location_type not null
);

-- ------------------------------------------------------ Utilisateurs

create type user_role as enum ('OWNER','MANAGER','PROCUREMENT','PREPARER','SELLER','FINANCE');

-- Adossé à auth.users : Supabase Auth reste la source d'identité.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id),
  name text not null,
  role user_role not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
  created_at timestamptz not null default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  device_identifier text not null,
  last_sync_at timestamptz,
  unique (user_id, device_identifier)
);

-- --------------------------------------------------------- Catalogue

create type item_kind as enum ('RAW_MATERIAL','PACKAGING','INTERMEDIATE','FINISHED');
create type unit_code as enum ('kg','g','L','mL','unite','sachet','bouteille','paquet','carton');

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  phone text,
  contact text,
  address text,
  notes text
);

create table items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  kind item_kind not null,
  unit unit_code not null,
  minimum_stock numeric(14,3),
  target_stock numeric(14,3),
  reorder_point numeric(14,3),
  lead_time_hours int,
  preferred_supplier_id uuid references suppliers(id),
  price numeric(14,2),
  -- Coût moyen pondéré : dérivé des réceptions, jamais saisi à la main.
  weighted_avg_cost numeric(14,4) not null default 0,
  active boolean not null default true
);

-- ---------------------------------------------------------- Recettes

create table recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  name text not null
);

create table recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  version int not null,
  -- RULE-005 : une version utilisée dans un batch est gelée.
  frozen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (recipe_id, version)
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references recipe_versions(id) on delete cascade,
  item_id uuid not null references items(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit unit_code not null
);

-- ---------------------------------------------------- Moteur de stock

create type movement_type as enum (
  'INITIAL','PURCHASE_RECEIPT','PRODUCTION_CONSUMPTION','PRODUCTION_OUTPUT',
  'SALE','TRANSFER_IN','TRANSFER_OUT','WASTE','RETURN','ADJUSTMENT'
);

-- RULE-002/003 : le stock n'existe que sous forme de mouvements.
-- Il n'y a volontairement AUCUNE colonne "quantité en stock" dans items.
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  location_id uuid not null references stock_locations(id),
  item_id uuid not null references items(id),
  quantity numeric(14,4) not null check (quantity <> 0),
  unit unit_code not null,
  movement_type movement_type not null,
  reference_type text not null,
  reference_id uuid not null,
  user_id uuid not null references profiles(id),
  device_id text,
  created_at timestamptz not null default now()
);

create index on stock_movements (item_id, location_id);
create index on stock_movements (organization_id, created_at desc);
create index on stock_movements (reference_type, reference_id);

-- Projection lue par l'application et les tableaux de bord.
create view stock_levels as
  select
    m.organization_id,
    m.site_id,
    m.location_id,
    m.item_id,
    sum(
      m.quantity * case
        -- Ramène tout à l'unité de base de la famille (g, mL, unité).
        when m.unit = 'kg' then 1000 when m.unit = 'L' then 1000
        when m.unit = 'carton' then 1 else 1
      end
      / case
        when i.unit = 'kg' then 1000 when i.unit = 'L' then 1000 else 1
      end
    ) as quantity,
    i.unit
  from stock_movements m
  join items i on i.id = m.item_id
  group by m.organization_id, m.site_id, m.location_id, m.item_id, i.unit;

-- ------------------------------------------------------- Achats

create type purchase_order_status as enum (
  'DRAFT','PENDING_APPROVAL','APPROVED','PURCHASING',
  'PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED'
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  po_number text not null,
  supplier_id uuid references suppliers(id),
  status purchase_order_status not null default 'DRAFT',
  requested_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  comment text,
  created_at timestamptz not null default now(),
  unique (organization_id, po_number)
);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid not null references items(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit unit_code not null,
  expected_unit_price numeric(14,2)
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  purchase_order_id uuid references purchase_orders(id),
  supplier_id uuid references suppliers(id),
  location_id uuid not null references stock_locations(id),
  transport_cost numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  payment_method text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  received_at timestamptz
);

create table purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  item_id uuid not null references items(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit unit_code not null,
  expected_unit_price numeric(14,2),
  actual_unit_price numeric(14,2) not null,
  -- §18 : l'écart prix est conservé, pas recalculé à l'affichage.
  price_variance numeric(14,2) generated always as
    (coalesce(actual_unit_price - expected_unit_price, 0)) stored
);

-- Historique des prix : alimente moyennes 7/30 j et alertes de dérive.
create table price_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  supplier_id uuid references suppliers(id),
  unit_price numeric(14,2) not null,
  observed_at timestamptz not null default now()
);
create index on price_observations (item_id, observed_at desc);

-- --------------------------------------------------------- Production

create table production_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  code text not null,
  item_id uuid not null references items(id),
  recipe_version_id uuid not null references recipe_versions(id),
  preparer_id uuid not null references profiles(id),
  location_id uuid not null references stock_locations(id),
  planned_quantity numeric(14,3) not null,
  produced_quantity numeric(14,3) not null,
  loss_quantity numeric(14,3) not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, code)
);

-- ------------------------------------------------------------- Ventes

create type sale_status as enum ('COMPLETED','VOIDED','REFUNDED');

create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  seller_id uuid not null references profiles(id),
  shift_number int not null,
  opening_cash numeric(14,2) not null default 0,
  counted_cash numeric(14,2),
  variance_reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  location_id uuid not null references stock_locations(id),
  cash_session_id uuid references cash_sessions(id),
  seller_id uuid not null references profiles(id),
  number bigint not null,
  total numeric(14,2) not null,
  cogs numeric(14,2) not null default 0,
  payment_method text not null,
  amount_received numeric(14,2) not null default 0,
  status sale_status not null default 'COMPLETED',
  void_reason text,
  voided_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, number)
);

create table sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  item_id uuid not null references items(id),
  name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null,
  -- COGS figé à l'instant de la vente : le coût d'aujourd'hui n'est pas celui de demain.
  unit_cost numeric(14,4) not null
);

-- ---------------------------------------------------------- Finance

create table expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id),
  amount numeric(14,2) not null check (amount >= 0),
  category text not null,
  description text not null,
  supplier_id uuid references suppliers(id),
  payment_method text not null,
  attachment_path text,
  user_id uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table waste_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  location_id uuid not null references stock_locations(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit unit_code not null,
  cost numeric(14,2) not null default 0,
  reason text not null,
  user_id uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- Inventaire

create table inventory_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references stock_locations(id),
  user_id uuid not null references profiles(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','VALIDATED')),
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

create table inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references inventory_counts(id) on delete cascade,
  item_id uuid not null references items(id),
  theoretical numeric(14,4) not null,
  counted numeric(14,4) not null,
  variance numeric(14,4) generated always as (counted - theoretical) stored,
  reason text
);

-- ------------------------------------ Événements, audit, notifications

create type sync_status as enum ('LOCAL_ONLY','QUEUED','SYNCING','SYNCED','FAILED','CONFLICT');

-- §56 — Idempotence : l'id vient du client. Un même id ne peut produire
-- qu'une seule transaction métier, ce qui neutralise les retries réseau.
create table domain_events (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  actor_user_id uuid references profiles(id),
  device_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at_local timestamptz not null,
  created_at_server timestamptz not null default now()
);
create index on domain_events (organization_id, created_at_server desc);
create index on domain_events (event_type);

-- RULE : l'audit n'est jamais modifiable par un utilisateur standard.
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references profiles(id),
  user_name text not null,
  role user_role not null,
  action text not null,
  detail text,
  before_state jsonb,
  after_state jsonb,
  reference text,
  device_id text,
  created_at timestamptz not null default now()
);
create index on audit_events (organization_id, created_at desc);

create type severity as enum ('INFO','ATTENTION','ACTION_REQUIRED','CRITICAL');

create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  event_type text not null,
  condition jsonb not null default '{}'::jsonb,
  severity severity not null default 'INFO',
  cooldown_minutes int not null default 30,
  recipient_roles user_role[] not null default '{}',
  channels text[] not null default '{IN_APP}',
  enabled boolean not null default true
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_id uuid references notification_rules(id) on delete set null,
  event_id uuid references domain_events(id) on delete set null,
  recipient_user_id uuid references profiles(id) on delete cascade,
  title text not null,
  body text,
  severity severity not null default 'INFO',
  action_type text,
  action_target text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz
);
create index on notifications (recipient_user_id, created_at desc);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  device_id text,
  subscription jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- §45 — déduplication : une même condition ne réveille pas dix fois.
create table notification_cooldowns (
  rule_id uuid not null references notification_rules(id) on delete cascade,
  scope_key text not null,
  last_fired_at timestamptz not null default now(),
  last_severity severity,
  primary key (rule_id, scope_key)
);
