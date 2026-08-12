-- =====================================================================
-- BUNA Operations — amorçage d'un projet neuf.
-- À exécuter APRÈS 0001, 0002 et 0003, dans le SQL Editor.
-- Idempotent : réexécutable sans créer de doublons.
-- =====================================================================

-- Organisation, site, emplacements ------------------------------------

insert into organizations (id, name, currency, timezone)
values ('11111111-1111-1111-1111-111111111111', 'BUNA', 'XOF', 'Africa/Dakar')
on conflict (id) do nothing;

insert into sites (id, organization_id, name)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'Coffee Bar Auchan')
on conflict (id) do nothing;

insert into stock_locations (id, site_id, name, type) values
  ('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222222', 'Stock principal',   'CENTRAL'),
  ('33333333-3333-3333-3333-333333333302', '22222222-2222-2222-2222-222222222222', 'Cuisine',           'KITCHEN'),
  ('33333333-3333-3333-3333-333333333303', '22222222-2222-2222-2222-222222222222', 'Frigo',             'FRIDGE'),
  ('33333333-3333-3333-3333-333333333304', '22222222-2222-2222-2222-222222222222', 'Coffee Bar Auchan', 'POS')
on conflict (id) do nothing;

-- Fournisseurs ---------------------------------------------------------

insert into suppliers (id, organization_id, name, phone, contact) values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111', 'Laiterie du Terroir', '77 812 44 10', 'M. Sarr'),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111', 'Torréfaction Dakar',  '76 330 09 55', 'Mme Faye'),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111', 'Emballages Plus',     '78 221 76 03', null)
on conflict (id) do nothing;

-- Catalogue ------------------------------------------------------------
-- Les coûts sont des valeurs de départ : chaque réception les recalcule
-- en moyenne pondérée.

insert into items (id, organization_id, name, kind, unit, minimum_stock, target_stock, price, weighted_avg_cost, preferred_supplier_id) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lait entier',         'RAW_MATERIAL', 'L',     10,  30,  null,  1062, '44444444-4444-4444-4444-444444444401'),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Café en grains',      'RAW_MATERIAL', 'kg',     8,  25,  null,  4500, '44444444-4444-4444-4444-444444444402'),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sirop vanille',       'RAW_MATERIAL', 'L',      3,  10,  null,  3200, null),
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Sirop caramel',       'RAW_MATERIAL', 'L',      3,  10,  null,  3300, null),
  ('55555555-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Poudre matcha',       'RAW_MATERIAL', 'kg',     1,   4,  null, 22000, null),
  ('55555555-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Glaçons',             'RAW_MATERIAL', 'kg',    10,  40,  null,   200, null),
  ('55555555-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Gobelets 16 oz',      'PACKAGING',    'unite',200, 800,  null,    28, '44444444-4444-4444-4444-444444444403'),
  ('55555555-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Couvercles',          'PACKAGING',    'unite',200, 800,  null,    12, '44444444-4444-4444-4444-444444444403'),
  ('55555555-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Pailles',             'PACKAGING',    'unite',200, 800,  null,     6, '44444444-4444-4444-4444-444444444403'),
  ('55555555-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Vanilla Iced Coffee', 'FINISHED',     'unite', 10,  40,  2500,  1020, null),
  ('55555555-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Caramel Latte',       'FINISHED',     'unite', 10,  40,  2500,  1080, null),
  ('55555555-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Mocha Iced Coffee',   'FINISHED',     'unite',  8,  30,  2500,  1110, null),
  ('55555555-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'Matcha Latte',        'FINISHED',     'unite',  6,  24,  2500,  1240, null),
  ('55555555-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'Cold Brew',           'FINISHED',     'unite',  6,  24,  3000,  1160, null),
  ('55555555-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'Espresso Tonic',      'FINISHED',     'unite',  5,  20,  3000,  1290, null)
on conflict (id) do nothing;

-- Profils --------------------------------------------------------------
-- Créez d'abord les comptes dans Authentication → Users, avec ces e-mails.
-- Ce bloc les rattache ensuite automatiquement, sans copier d'UUID à la main.

insert into profiles (id, organization_id, site_id, name, role)
select u.id,
       '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222',
       v.name,
       v.role::user_role
from auth.users u
join (values
        ('aicha@buna.sn',   'Aïcha Ndiaye',   'SELLER'),
        ('ibrahim@buna.sn', 'Ibrahim Sow',    'PREPARER'),
        ('fatou@buna.sn',   'Fatou Ba',       'PROCUREMENT'),
        ('awa@buna.sn',     'Awa Diop',       'MANAGER'),
        ('mamadou@buna.sn', 'Mamadou Diallo', 'OWNER'),
        ('seydou@buna.sn',  'Seydou Fall',    'FINANCE')
     ) as v(email, name, role) on v.email = u.email
on conflict (id) do nothing;

-- Contrôle -------------------------------------------------------------
-- Doit renvoyer 1 organisation, 1 site, 4 emplacements, 15 articles,
-- et autant de profils que de comptes créés.

select
  (select count(*) from organizations)   as organisations,
  (select count(*) from sites)           as sites,
  (select count(*) from stock_locations) as emplacements,
  (select count(*) from items)           as articles,
  (select count(*) from suppliers)       as fournisseurs,
  (select count(*) from profiles)        as profils;
