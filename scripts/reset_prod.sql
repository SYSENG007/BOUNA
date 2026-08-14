-- 1. Nettoyage des transactions (dans l'ordre pour respecter les contraintes de clés étrangères)
DELETE FROM public.domain_events;
DELETE FROM public.stock_movements;
DELETE FROM public.sale_lines;
DELETE FROM public.sales;
DELETE FROM public.purchase_lines;
DELETE FROM public.purchases;
DELETE FROM public.expenses;
DELETE FROM public.production_batches;
DELETE FROM public.cash_sessions;
DELETE FROM public.variances;
DELETE FROM public.notifications;
DELETE FROM public.audit_events;
DELETE FROM public.waste_events;
DELETE FROM public.inventory_count_lines;
DELETE FROM public.inventory_counts;

-- 2. Nettoyage et mise à jour du catalogue (Items)
-- On supprime les anciens items pour être propre
DELETE FROM public.items;

-- Insertion des nouveaux items avec les vrais prix (pour ceux fournis)
INSERT INTO public.items (id, organization_id, name, kind, unit, minimum_stock, target_stock, price, weighted_avg_cost) VALUES
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cacao', 'RAW_MATERIAL', 'kg', 1, 5, null, 1825),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Lait concentré', 'RAW_MATERIAL', 'unite', 5, 20, null, 1000),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Nutella', 'RAW_MATERIAL', 'unite', 2, 10, null, 6475),
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Essence vanille', 'RAW_MATERIAL', 'L', 1, 5, null, 2500),
  ('55555555-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Essence caramel', 'RAW_MATERIAL', 'L', 1, 5, null, 2500),
  ('55555555-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Bouteille miel', 'RAW_MATERIAL', 'unite', 2, 10, null, 3000),
  ('55555555-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Sucre 5Kg', 'RAW_MATERIAL', 'unite', 1, 5, null, 4000),
  ('55555555-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Chantilly', 'RAW_MATERIAL', 'unite', 5, 20, null, 2790),
  ('55555555-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Lait Dano', 'RAW_MATERIAL', 'unite', 5, 20, null, 1550),
  ('55555555-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Pack paille', 'PACKAGING', 'unite', 2, 10, null, 1000),
  ('55555555-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Pack gobelet PM', 'PACKAGING', 'unite', 5, 20, null, 2175),
  ('55555555-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Pack gobelet moyen', 'PACKAGING', 'unite', 5, 20, null, 2500),
  ('55555555-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'Pack gobelet GM', 'PACKAGING', 'unite', 5, 20, null, 3000),
  ('55555555-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'Pack bouteille 10L de 5', 'PACKAGING', 'unite', 2, 10, null, 1200);

-- Les produits finis
INSERT INTO public.items (id, organization_id, name, kind, unit, minimum_stock, target_stock, price, weighted_avg_cost) VALUES
  ('55555555-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'Vanilla Iced Coffee', 'FINISHED', 'unite', 10, 40, 2500, 1020),
  ('55555555-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'Caramel Latte', 'FINISHED', 'unite', 10, 40, 2500, 1080),
  ('55555555-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'Mocha Iced Coffee', 'FINISHED', 'unite', 8, 30, 2500, 1110),
  ('55555555-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', 'Matcha Latte', 'FINISHED', 'unite', 6, 24, 2500, 1240),
  ('55555555-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'Cold Brew', 'FINISHED', 'unite', 6, 24, 3000, 1160);


-- 3. Nettoyage et mise à jour de l'équipe (Utilisateurs et Profils)
-- Suppression des anciens utilisateurs du projet
DELETE FROM auth.users WHERE email IN (
  'aicha@buna.sn', 'fatou@buna.sn', 'awa@buna.sn', 'seydou@buna.sn', 'mamadou@buna.sn', 'ibrahim@buna.sn'
);

-- Insertion des nouveaux utilisateurs avec le mot de passe générique : buna2024
-- Note : L'insertion dans auth.users nécessite l'extension pgcrypto (déjà active par défaut sur Supabase).
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'buna@buna.sn', crypt('buna2024', gen_salt('bf')), current_timestamp, '{"provider":"email","providers":["email"]}', '{}', current_timestamp, current_timestamp),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'baboy@buna.sn', crypt('buna2024', gen_salt('bf')), current_timestamp, '{"provider":"email","providers":["email"]}', '{}', current_timestamp, current_timestamp),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'matel@buna.sn', crypt('buna2024', gen_salt('bf')), current_timestamp, '{"provider":"email","providers":["email"]}', '{}', current_timestamp, current_timestamp),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'maty@buna.sn', crypt('buna2024', gen_salt('bf')), current_timestamp, '{"provider":"email","providers":["email"]}', '{}', current_timestamp, current_timestamp),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'ibrahima@buna.sn', crypt('buna2024', gen_salt('bf')), current_timestamp, '{"provider":"email","providers":["email"]}', '{}', current_timestamp, current_timestamp);

-- Le trigger Supabase insère automatiquement les profils.
-- On met à jour les rôles et noms qui sont liés à l'email pour s'assurer que c'est correct.
UPDATE public.profiles SET post = 'OWNER', name = 'Buna' WHERE id = (SELECT id FROM auth.users WHERE email = 'buna@buna.sn');
UPDATE public.profiles SET post = 'MANAGER', name = 'Baboy' WHERE id = (SELECT id FROM auth.users WHERE email = 'baboy@buna.sn');
UPDATE public.profiles SET post = 'MANAGER', name = 'Matel' WHERE id = (SELECT id FROM auth.users WHERE email = 'matel@buna.sn');
UPDATE public.profiles SET post = 'FINANCE', name = 'Maty' WHERE id = (SELECT id FROM auth.users WHERE email = 'maty@buna.sn');
UPDATE public.profiles SET post = 'PREPARER', name = 'Ibrahima' WHERE id = (SELECT id FROM auth.users WHERE email = 'ibrahima@buna.sn');

