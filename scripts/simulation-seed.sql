-- =====================================================================
-- BUNA Operations — bac à sable de simulation
--
-- Monte une SECONDE organisation, « BUNA — Simulation », dans le même projet
-- Supabase, avec ses propres comptes de connexion.
--
-- Pourquoi une organisation plutôt qu'un drapeau sur chaque ligne : parce que
-- le cloisonnement existe déjà et qu'il est tenu par PostgreSQL. Toutes les
-- politiques RLS filtrent sur `current_org_id()`, qui se lit dans le profil du
-- compte connecté. Un compte de simulation ne peut donc pas écrire dans la
-- maison réelle — ce n'est pas une discipline à respecter, c'est un refus de
-- la base. Et la fin de simulation tient en un `delete` : voir
-- `simulation-purge.sql`.
--
-- Ce que la simulation teste, et qu'un mode local ne testerait pas : les
-- fonctions transactionnelles (`complete_sale`, `receive_goods`, `close_cash_
-- session`…), l'idempotence par `event.id`, le coût moyen pondéré côté
-- serveur, RLS, et le régime d'exploitation. C'est-à-dire tout ce qui fait la
-- différence entre « ça marche à l'écran » et « ça marche ».
--
-- Le script est rejouable : il commence par effacer la simulation précédente.
--
-- Usage :
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
--        -f scripts/simulation-seed.sql
--   ou : coller dans Supabase → SQL Editor
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Table rase — la simulation précédente, s'il y en avait une
--
-- Mêmes garde-fous que `simulation-purge.sql` : on ne supprime que
-- l'organisation qui porte l'identifiant ET le nom attendus.
-- ---------------------------------------------------------------------

do $$
declare
  c_org constant uuid := '99999999-9999-9999-9999-999999999999';
  c_nom constant text := 'BUNA — Simulation';
  v_nom text;
begin
  select name into v_nom from public.organizations where id = c_org;
  if v_nom is not null and v_nom is distinct from c_nom then
    raise exception
      'REFUS : l''organisation % s''appelle « % », pas « % ». Rien n''a été touché.',
      c_org, v_nom, c_nom;
  end if;
  /*
   * Les tables de lignes, d'abord.
   *
   * Cinq d'entre elles référencent `items` en NO ACTION et ne portent pas
   * d'`organization_id` : la cascade depuis `organizations` supprime `items`
   * ET leur table parente dans la même instruction, sans garantie que la
   * ligne fille soit partie avant que la contrainte sur `items` ne soit
   * vérifiée. La suppression échoue alors sur
   * « violates foreign key constraint sale_lines_item_id_fkey ».
   *
   * Le défaut ne se voit que sur une simulation qui a réellement vendu ou
   * acheté quelque chose — un bac à sable vide se supprime très bien. On
   * retire donc ces lignes explicitement, en les rattachant à l'organisation
   * par leur parent.
   *
   * Toute modification ici doit être reportée dans `simulation-seed.sql`,
   * dont l'étape 0 efface la simulation précédente de la même façon.
   */
  delete from public.sale_lines
   where sale_id in (select id from public.sales where organization_id = c_org);

  delete from public.purchase_lines
   where purchase_id in (select id from public.purchases where organization_id = c_org);

  delete from public.purchase_order_lines
   where purchase_order_id in (select id from public.purchase_orders where organization_id = c_org);

  delete from public.inventory_count_lines
   where inventory_count_id in (select id from public.inventory_counts where organization_id = c_org);

  delete from public.recipe_ingredients
   where recipe_version_id in (
     select v.id from public.recipe_versions v
       join public.recipes r on r.id = v.recipe_id
      where r.organization_id = c_org
   );

  delete from public.organizations where id = c_org;
  delete from auth.users where email like '%@simu.buna.sn';
end $$;


-- ---------------------------------------------------------------------
-- 1. L'organisation, le site, les emplacements
--
-- Identifiants fixes, famille en 9 : la maison réelle est en 1, son site en
-- 2, ses emplacements en 3. Un 9 en tête se repère d'un coup d'œil dans
-- n'importe quelle requête de diagnostic — et le client s'en sert comme
-- constante pour afficher le bandeau « Mode simulation ».
--
-- Le régime démarre en SIMPLE : c'est celui d'une maison qui commence, et la
-- bascule vers PRÉCIS fait partie de ce qu'on vient tester.
-- ---------------------------------------------------------------------

insert into public.organizations (id, name, currency, timezone) values
  ('99999999-9999-9999-9999-999999999999', 'BUNA — Simulation', 'XOF', 'Africa/Dakar');

insert into public.sites (id, organization_id, name, operating_mode) values
  ('99999999-0000-0000-0000-000000000001',
   '99999999-9999-9999-9999-999999999999',
   'Coffee Bar Auchan (simulation)',
   'SIMPLE');

insert into public.stock_locations (id, site_id, name, type) values
  ('99999999-0000-0000-0000-000000000011', '99999999-0000-0000-0000-000000000001', 'Stock principal',   'CENTRAL'),
  ('99999999-0000-0000-0000-000000000012', '99999999-0000-0000-0000-000000000001', 'Cuisine',           'KITCHEN'),
  ('99999999-0000-0000-0000-000000000013', '99999999-0000-0000-0000-000000000001', 'Frigo',             'FRIDGE'),
  ('99999999-0000-0000-0000-000000000014', '99999999-0000-0000-0000-000000000001', 'Coffee Bar Auchan', 'POS');


-- ---------------------------------------------------------------------
-- 2. Fournisseurs et catalogue — recopiés de la maison réelle
--
-- On ne réinvente pas un catalogue de démonstration : on teste avec les
-- articles, les prix et les coûts réels. Un cycle qui tourne sur un
-- catalogue fictif ne dit rien de celui qui tournera lundi matin.
--
-- Les identifiants sont neufs (rien de partagé entre les deux organisations),
-- mais les NOMS sont identiques — et c'est ce qui compte côté client :
-- `applyReferentials` rapproche les référentiels par nom, donc l'application
-- se rebranche toute seule sur les identifiants du bac à sable.
--
-- L'organisation source est la plus ancienne, comme partout ailleurs dans ce
-- schéma (`handle_new_user` fait le même choix) — jamais un identifiant en dur.
-- ---------------------------------------------------------------------

insert into public.suppliers (
  id, organization_id, name, phone, contact, address, notes,
  lead_time_days, payment_terms, active
)
select
  gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
  s.name, s.phone, s.contact, s.address, s.notes,
  s.lead_time_days, s.payment_terms, s.active
from public.suppliers s
where s.organization_id = (select id from public.organizations
                            where id <> '99999999-9999-9999-9999-999999999999'
                            order by created_at limit 1);

insert into public.items (
  id, organization_id, name, kind, unit, minimum_stock, target_stock,
  reorder_point, lead_time_hours, preferred_supplier_id, price,
  weighted_avg_cost, active, production_mode
)
select
  gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
  i.name, i.kind, i.unit, i.minimum_stock, i.target_stock,
  i.reorder_point, i.lead_time_hours,
  -- Le fournisseur préféré se retrouve par son nom dans le bac à sable :
  -- pointer vers celui de la maison réelle serait une fuite entre organisations.
  (select sim.id from public.suppliers sim
    where sim.organization_id = '99999999-9999-9999-9999-999999999999'
      and sim.name = (select src.name from public.suppliers src
                       where src.id = i.preferred_supplier_id)),
  i.price, i.weighted_avg_cost, i.active, i.production_mode
from public.items i
where i.organization_id = (select id from public.organizations
                            where id <> '99999999-9999-9999-9999-999999999999'
                            order by created_at limit 1);


-- ---------------------------------------------------------------------
-- 3. Recettes — recopiées elles aussi, si la maison en a
--
-- Vide aujourd'hui : personne n'a encore enregistré de recette côté serveur,
-- et le régime SIMPLE n'en exige pas (`complete_batch` accepte un lot sans
-- recette). Le jour où il y en aura, la simulation les prendra sans qu'on
-- retouche à ce fichier.
--
-- Trois étapes parce que les trois tables se référencent en boucle : la
-- recette pointe sa version courante, la version pointe sa recette. On insère
-- donc les recettes sans version courante, puis les versions, puis on referme.
-- ---------------------------------------------------------------------

insert into public.recipes (id, organization_id, item_id, name, current_version_id)
select
  gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
  (select sim.id from public.items sim
    where sim.organization_id = '99999999-9999-9999-9999-999999999999'
      and sim.name = (select src.name from public.items src where src.id = r.item_id)),
  r.name, null
from public.recipes r
where r.organization_id = (select id from public.organizations
                            where id <> '99999999-9999-9999-9999-999999999999'
                            order by created_at limit 1);

insert into public.recipe_versions (id, recipe_id, version, frozen, created_at)
select
  gen_random_uuid(),
  (select sim.id from public.recipes sim
    where sim.organization_id = '99999999-9999-9999-9999-999999999999'
      and sim.name = src_r.name),
  v.version, v.frozen, v.created_at
from public.recipe_versions v
join public.recipes src_r on src_r.id = v.recipe_id
where src_r.organization_id = (select id from public.organizations
                                where id <> '99999999-9999-9999-9999-999999999999'
                                order by created_at limit 1);

insert into public.recipe_ingredients (id, recipe_version_id, item_id, quantity, unit)
select
  gen_random_uuid(),
  (select sim_v.id
     from public.recipe_versions sim_v
     join public.recipes sim_r on sim_r.id = sim_v.recipe_id
    where sim_r.organization_id = '99999999-9999-9999-9999-999999999999'
      and sim_r.name = src_r.name
      and sim_v.version = src_v.version),
  (select sim_i.id from public.items sim_i
    where sim_i.organization_id = '99999999-9999-9999-9999-999999999999'
      and sim_i.name = (select src_i.name from public.items src_i where src_i.id = ing.item_id)),
  ing.quantity, ing.unit
from public.recipe_ingredients ing
join public.recipe_versions src_v on src_v.id = ing.recipe_version_id
join public.recipes src_r on src_r.id = src_v.recipe_id
where src_r.organization_id = (select id from public.organizations
                                where id <> '99999999-9999-9999-9999-999999999999'
                                order by created_at limit 1);

-- La version courante, maintenant que les deux côtés existent.
update public.recipes sim
   set current_version_id = (
     select sim_v.id from public.recipe_versions sim_v
      where sim_v.recipe_id = sim.id
      order by sim_v.version desc limit 1
   )
 where sim.organization_id = '99999999-9999-9999-9999-999999999999';


-- ---------------------------------------------------------------------
-- 4. Les comptes de simulation
--
-- Un domaine à part, `@simu.buna.sn`, pour que la suppression des comptes
-- repose sur un prédicat qui ne peut pas déborder sur `@buna.sn`.
--
-- Le déclencheur `handle_new_user` s'exécute à l'insertion et range le profil
-- dans l'organisation LA PLUS ANCIENNE — donc la maison réelle. C'est correct
-- pour une vraie embauche, et faux ici : on rapatrie donc profil et capacités
-- juste après, dans la même transaction. Rien n'est visible de l'extérieur
-- entre les deux.
--
-- On ne touche PAS au déclencheur pour lui faire lire une organisation dans
-- `raw_user_meta_data` : ces métadonnées sont fournies par le client à
-- l'inscription. Un compte pourrait alors choisir son organisation — la
-- brèche exacte que RLS existe pour fermer.
-- ---------------------------------------------------------------------

do $$
declare
  c_org  constant uuid := '99999999-9999-9999-9999-999999999999';
  c_site constant uuid := '99999999-0000-0000-0000-000000000001';
  -- Mot de passe commun aux six comptes. À changer si le projet cesse d'être
  -- un bac à sable — mais il est effacé à chaque fin de simulation.
  c_mdp  constant text := 'simulation2026';
  r      record;
  v_id   uuid;
begin
  for r in
    select * from (values
      ('patron@simu.buna.sn',  'Simu Patron',      'OWNER'),
      ('gerant@simu.buna.sn',  'Simu Gérant',      'MANAGER'),
      ('vendeur@simu.buna.sn', 'Simu Vendeur',     'SELLER'),
      ('prepa@simu.buna.sn',   'Simu Préparateur', 'PREPARER'),
      ('appro@simu.buna.sn',   'Simu Appro',       'PROCUREMENT'),
      ('finance@simu.buna.sn', 'Simu Finance',     'FINANCE')
    ) as t(courriel, nom, poste)
  loop
    v_id := gen_random_uuid();

    /*
     * Les colonnes de jeton sont mises à la chaîne vide, jamais laissées à
     * NULL : le service d'authentification les lit comme des chaînes, et un
     * NULL le fait échouer à la connexion — sur un message qui ne parle ni de
     * mot de passe ni de compte, donc introuvable depuis l'application.
     */
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new,
      email_change_token_current, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      r.courriel,
      extensions.crypt(c_mdp, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', r.nom, 'post', r.poste),
      now(), now(),
      '', '', '', '', ''
    );

    update public.profiles
       set organization_id = c_org, site_id = c_site,
           name = r.nom, post = r.poste::public.user_post
     where id = v_id;

    update public.user_capabilities
       set organization_id = c_org
     where user_id = v_id;
  end loop;

  /*
   * `MANAGE_SETTINGS` n'est pas dans les préréglages du déclencheur.
   *
   * La capacité est née avec la migration 0023, et 0024 l'a accordée aux
   * propriétaires et managers DÉJÀ en place — mais `handle_new_user` n'a
   * jamais été mis à jour. Tout compte créé depuis en est donc dépourvu, et
   * l'écran du régime d'exploitation lui est fermé.
   *
   * On applique ici la même règle que 0024, pour que le bac à sable
   * ressemble à une maison correctement dotée et non à un compte neuf
   * accidentellement diminué. Le défaut du déclencheur, lui, reste entier :
   * il se corrige dans une migration, pas dans un script de simulation.
   */
  insert into public.user_capabilities (organization_id, user_id, capability, granted_by, granted_at)
  select p.organization_id, p.id, 'MANAGE_SETTINGS'::public.capability, p.id, now()
    from public.profiles p
   where p.organization_id = c_org
     and p.post in ('OWNER', 'MANAGER')
     and not exists (
       select 1 from public.user_capabilities uc
        where uc.user_id = p.id
          and uc.capability = 'MANAGE_SETTINGS'::public.capability
          and uc.revoked_at is null
     );
end $$;


-- ---------------------------------------------------------------------
-- 5. Le stock d'ouverture
--
-- Un mouvement INITIAL par matière première et par emballage, dans le stock
-- principal. Pas de niveau de stock écrit nulle part (RULE-002/003) : ce sont
-- des faits datés, et le stock reste une projection — ici comme partout.
--
-- Deux articles sont volontairement laissés SOUS leur minimum. Sans cela, la
-- liste de courses et les alertes de rupture ouvriraient la journée à vide et
-- la simulation ne dirait rien d'elles. Une matinée qui commence par un
-- manque, c'est la matinée normale.
--
-- Les produits finis n'ont pas de stock : ils sont tous en MADE_TO_ORDER, on
-- les prépare à la commande. C'est la vente qui consommera les ingrédients.
-- ---------------------------------------------------------------------

insert into public.stock_movements (
  organization_id, site_id, location_id, item_id, quantity, unit,
  movement_type, reference_type, reference_id, user_id, device_id, created_at,
  actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
)
select
  '99999999-9999-9999-9999-999999999999',
  '99999999-0000-0000-0000-000000000001',
  '99999999-0000-0000-0000-000000000011',
  i.id,
  coalesce(manque.quantite, i.target_stock, 10),
  i.unit,
  'INITIAL', 'SimulationOpening', '99999999-9999-9999-9999-999999999999',
  patron.id, 'simulation', now(),
  patron.id, patron.name, patron.post, 'COUNT_INVENTORY', now()
from public.items i
cross join lateral (
  select p.id, p.name, p.post
    from public.profiles p
   where p.organization_id = '99999999-9999-9999-9999-999999999999'
     and p.post = 'OWNER'
   limit 1
) as patron
left join (values
  -- Sous le minimum, exprès : la journée doit commencer par un manque.
  ('Lait concentré',     2::numeric),
  ('Pack gobelet moyen', 1::numeric)
) as manque(nom, quantite) on manque.nom = i.name
where i.organization_id = '99999999-9999-9999-9999-999999999999'
  and i.kind in ('RAW_MATERIAL', 'PACKAGING')
  and i.active
  and coalesce(manque.quantite, i.target_stock, 10) <> 0;


-- ---------------------------------------------------------------------
-- 6. Contrôle — ce que la simulation a sous la main en ouvrant
-- ---------------------------------------------------------------------

select
  (select name  from public.organizations where id = '99999999-9999-9999-9999-999999999999') as organisation,
  (select count(*) from public.profiles        where organization_id = '99999999-9999-9999-9999-999999999999') as comptes,
  (select count(*) from public.items           where organization_id = '99999999-9999-9999-9999-999999999999') as articles,
  (select count(*) from public.suppliers       where organization_id = '99999999-9999-9999-9999-999999999999') as fournisseurs,
  (select count(*) from public.stock_movements where organization_id = '99999999-9999-9999-9999-999999999999') as mouvements_ouverture,
  (select count(*) from public.sales           where organization_id = '99999999-9999-9999-9999-999999999999') as ventes;

-- Les articles qui ouvrent sous leur minimum : la liste de courses du matin.
select i.name as article, sm.quantity as en_stock, i.minimum_stock as minimum
  from public.items i
  join public.stock_movements sm on sm.item_id = i.id
 where i.organization_id = '99999999-9999-9999-9999-999999999999'
   and i.minimum_stock is not null
   and sm.quantity < i.minimum_stock
 order by i.name;
