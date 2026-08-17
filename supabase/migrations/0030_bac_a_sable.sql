-- =====================================================================
-- 0030 — Le bac à sable s'ouvre depuis l'application.
--
-- `scripts/simulation-seed.sql` montait déjà une seconde organisation, mais
-- depuis un terminal, avec des comptes d'essai créés dans `auth.users`. Cette
-- migration met le même dispositif à portée de l'écran Profil, et sans créer
-- un seul compte.
--
-- LE CHANGEMENT DE FOND : la personne ne se déconnecte plus pour se reconnecter
-- sous une identité d'essai. C'est SON profil qui va dans le bac à sable, et
-- qui en revient. Trois conséquences, et c'est pour elles qu'on a choisi ainsi :
--
-- 1. Aucune fonction appelable depuis un navigateur n'écrit dans `auth.users`.
--    Créer des comptes depuis le client aurait demandé exactement ce
--    privilège — la pire surface possible pour une clé anon publique.
-- 2. La simulation se joue avec ses VRAIS droits. « Est-ce que moi, avec ce
--    que je détiens, je peux tenir une journée ? » est la question utile ;
--    un compte d'essai tout-puissant n'y répond pas.
-- 3. Plusieurs personnes peuvent entrer chacune de leur côté et se retrouver
--    dans le même bac à sable, avec leurs postes respectifs. Une répétition
--    générale à plusieurs, sans mot de passe partagé.
--
-- CE QUI NE CHANGE PAS : l'étanchéité reste tenue par RLS. Les politiques
-- filtrent sur `current_org_id()`, qui se lit dans le profil — donc déplacer le
-- profil déplace TOUT ce que la personne peut lire et écrire, d'un coup, sans
-- qu'aucun écran ne soit au courant. Et la purge reste un `delete` en cascade.
--
-- LE RISQUE ASSUMÉ, et son garde-fou : un profil qui pointe le bac à sable
-- serait détruit avec lui (`profiles.organization_id` cascade depuis
-- `organizations`). D'où les deux colonnes `home_*` ci-dessous, et d'où le fait
-- que `purge_simulation` ramène tout le monde chez soi AVANT de supprimer quoi
-- que ce soit. Aucune suppression ne peut emporter un compte.
--
-- Dépend de 0029 : `RUN_SIMULATION` doit déjà être proposée par le préréglage,
-- sinon l'invariant 9 de `verify_invariants.sql` refuse la capacité.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2. Le rattrapage pour les comptes déjà en place
--
-- Le préréglage ne vaut qu'à la création d'un compte. Une capacité née
-- aujourd'hui n'est donc accordée à personne, et l'écran qu'elle garde serait
-- inaccessible à tout le monde, y compris à celui qui a installé
-- l'application. Même geste qu'en 0024, même filtre : jamais une capacité déjà
-- RÉVOQUÉE, qui reste un fait daté qu'aucune migration ne défait.
-- ---------------------------------------------------------------------

insert into public.user_capabilities (organization_id, user_id, capability, granted_by, granted_at)
select p.organization_id, p.id, 'RUN_SIMULATION'::public.capability, p.id, now()
  from public.profiles p
 where p.post in ('OWNER', 'MANAGER')
   and not exists (
     select 1 from public.user_capabilities uc
      where uc.user_id = p.id
        and uc.capability = 'RUN_SIMULATION'::public.capability
   );


-- ---------------------------------------------------------------------
-- 3. Où revenir
--
-- Deux colonnes, et elles portent tout le dispositif. `home_organization_id`
-- non nul veut dire « cette personne est en simulation, et voici la maison
-- qu'elle a quittée ».
--
-- Pourquoi les stocker plutôt que déduire « la maison, c'est l'organisation la
-- plus ancienne » — la règle qu'emploient `handle_new_user` et le script de
-- montage : parce que cette règle est vraie tant qu'il n'y a qu'une seule
-- maison réelle. Le jour où BUNA ouvre un second établissement dans le même
-- projet, déduire renverrait des gens dans la mauvaise. Une personne qu'on
-- déplace doit savoir d'où elle vient, pas le supposer.
--
-- Pas de `on delete cascade` : si quelqu'un tentait de supprimer une
-- organisation pendant qu'une personne en est sortie pour simuler, mieux vaut
-- que PostgreSQL refuse que de perdre son chemin de retour.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists home_organization_id uuid references public.organizations(id),
  add column if not exists home_site_id         uuid references public.sites(id);

comment on column public.profiles.home_organization_id is
  'Maison quittée le temps d''une simulation. Non nul = cette personne est '
  'actuellement dans le bac à sable. Remis à NULL au retour.';

-- Qui est en simulation en ce moment. Index partiel : la colonne est nulle pour
-- tout le monde en temps normal, il n'y a donc presque rien à indexer.
create index if not exists profiles_en_simulation
  on public.profiles (home_organization_id)
  where home_organization_id is not null;


-- ---------------------------------------------------------------------
-- 4. L'identifiant du bac à sable
--
-- Une fonction plutôt qu'une constante recopiée dans cinq corps de fonction.
-- Elle doit dire exactement la même chose que `SIMULATION_ORG_ID`
-- (src/domain/simulation.ts) ; `simulation.test.ts` le vérifie.
--
-- Famille en 9, en écho au schéma réel : la maison est en 1, son site en 2, ses
-- emplacements en 3, ses fournisseurs en 4.
-- ---------------------------------------------------------------------

create or replace function public.simulation_org_id()
returns uuid
language sql
immutable
as $$ select '99999999-9999-9999-9999-999999999999'::uuid $$;

comment on function public.simulation_org_id() is
  'L''organisation bac à sable. Doit rester identique à SIMULATION_ORG_ID '
  'dans src/domain/simulation.ts.';


-- ---------------------------------------------------------------------
-- 5. Monter le bac à sable
--
-- Interne : jamais accordée à `authenticated`. Seule `enter_simulation`
-- l'appelle, et elle peut le faire parce qu'une fonction SECURITY DEFINER
-- s'exécute avec les privilèges de son propriétaire.
--
-- Idempotente : si l'organisation existe, on ne touche à rien. Deux personnes
-- qui entrent en même temps se retrouvent donc dans le MÊME bac à sable, et la
-- seconde n'efface pas la matinée de la première.
--
-- Le catalogue est RECOPIÉ de la maison réelle, pas réinventé : mêmes articles,
-- mêmes prix, mêmes coûts. Un cycle qui tourne sur un catalogue fictif ne dit
-- rien de celui qui tournera lundi matin. Les identifiants sont neufs — rien
-- n'est partagé entre les deux organisations — mais les NOMS sont identiques,
-- et c'est ce qui compte côté client : `applyReferentials` rapproche les
-- référentiels par nom, donc l'application se rebranche toute seule.
-- ---------------------------------------------------------------------

create or replace function public.build_simulation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_org     constant uuid := public.simulation_org_id();
  c_site    constant uuid := '99999999-0000-0000-0000-000000000001';
  c_central constant uuid := '99999999-0000-0000-0000-000000000011';
  v_source  uuid;
  v_auteur  uuid;
begin
  if exists (select 1 from public.organizations where id = c_org) then
    return;
  end if;

  -- La maison réelle : la plus ancienne qui ne soit pas le bac à sable. Même
  -- règle que `handle_new_user`, jamais un identifiant en dur.
  select id into v_source
    from public.organizations
   where id <> c_org
   order by created_at
   limit 1;

  if v_source is null then
    raise exception
      'Aucune organisation à recopier : la base n''est pas amorcée. '
      'Il n''y a rien à simuler.';
  end if;

  /*
   * À qui attribuer le stock d'ouverture.
   *
   * `auth.uid()` quand l'appel vient de l'application. Mais cette fonction est
   * aussi appelable depuis un terminal (`scripts/simulation.sh`), et là
   * `auth.uid()` est NUL — le stock d'ouverture se serait alors inséré à zéro
   * ligne, en silence, parce que la jointure sur `profiles` ne trouve rien. Un
   * bac à sable sans stock, sans message d'erreur, et sans moyen de comprendre.
   *
   * On retombe donc sur le propriétaire de la maison recopiée.
   */
  v_auteur := coalesce(
    auth.uid(),
    (select p.id from public.profiles p
      where p.organization_id = v_source and p.post = 'OWNER'
      order by p.created_at limit 1),
    (select p.id from public.profiles p
      where p.organization_id = v_source
      order by p.created_at limit 1)
  );

  if v_auteur is null then
    raise exception
      'Aucun profil dans l''organisation % : le stock d''ouverture n''aurait '
      'aucun auteur.', v_source;
  end if;

  insert into public.organizations (id, name, currency, timezone)
  select c_org, 'BUNA — Simulation', o.currency, o.timezone
    from public.organizations o where o.id = v_source;

  -- Le régime démarre en SIMPLE : celui d'une maison qui commence. La bascule
  -- vers PRÉCIS fait partie de ce qu'on vient éprouver.
  insert into public.sites (id, organization_id, name, operating_mode)
  values (c_site, c_org, 'Coffee Bar Auchan (simulation)', 'SIMPLE');

  insert into public.stock_locations (id, site_id, name, type) values
    (c_central,                              c_site, 'Stock principal',   'CENTRAL'),
    ('99999999-0000-0000-0000-000000000012', c_site, 'Cuisine',           'KITCHEN'),
    ('99999999-0000-0000-0000-000000000013', c_site, 'Frigo',             'FRIDGE'),
    ('99999999-0000-0000-0000-000000000014', c_site, 'Coffee Bar Auchan', 'POS');

  insert into public.suppliers (
    id, organization_id, name, phone, contact, address, notes,
    lead_time_days, payment_terms, active
  )
  select gen_random_uuid(), c_org, s.name, s.phone, s.contact, s.address, s.notes,
         s.lead_time_days, s.payment_terms, s.active
    from public.suppliers s
   where s.organization_id = v_source;

  insert into public.items (
    id, organization_id, name, kind, unit, minimum_stock, target_stock,
    reorder_point, lead_time_hours, preferred_supplier_id, price,
    weighted_avg_cost, active, production_mode
  )
  select gen_random_uuid(), c_org, i.name, i.kind, i.unit,
         i.minimum_stock, i.target_stock, i.reorder_point, i.lead_time_hours,
         -- Le fournisseur préféré se retrouve par son nom dans le bac à sable :
         -- pointer celui de la maison réelle serait une fuite entre organisations.
         (select sim.id from public.suppliers sim
           where sim.organization_id = c_org
             and sim.name = (select src.name from public.suppliers src
                              where src.id = i.preferred_supplier_id)),
         i.price, i.weighted_avg_cost, i.active, i.production_mode
    from public.items i
   where i.organization_id = v_source;

  /*
   * Les recettes, en trois temps : les trois tables se référencent en boucle —
   * la recette pointe sa version courante, la version pointe sa recette. On
   * insère donc les recettes sans version, puis les versions, puis on referme.
   */
  insert into public.recipes (id, organization_id, item_id, name, current_version_id)
  select gen_random_uuid(), c_org,
         (select sim.id from public.items sim
           where sim.organization_id = c_org
             and sim.name = (select src.name from public.items src where src.id = r.item_id)),
         r.name, null
    from public.recipes r
   where r.organization_id = v_source;

  insert into public.recipe_versions (id, recipe_id, version, frozen, created_at)
  select gen_random_uuid(),
         (select sim.id from public.recipes sim
           where sim.organization_id = c_org and sim.name = src_r.name),
         v.version, v.frozen, v.created_at
    from public.recipe_versions v
    join public.recipes src_r on src_r.id = v.recipe_id
   where src_r.organization_id = v_source;

  insert into public.recipe_ingredients (id, recipe_version_id, item_id, quantity, unit)
  select gen_random_uuid(),
         (select sim_v.id
            from public.recipe_versions sim_v
            join public.recipes sim_r on sim_r.id = sim_v.recipe_id
           where sim_r.organization_id = c_org
             and sim_r.name = src_r.name
             and sim_v.version = src_v.version),
         (select sim_i.id from public.items sim_i
           where sim_i.organization_id = c_org
             and sim_i.name = (select src_i.name from public.items src_i
                                where src_i.id = ing.item_id)),
         ing.quantity, ing.unit
    from public.recipe_ingredients ing
    join public.recipe_versions src_v on src_v.id = ing.recipe_version_id
    join public.recipes src_r on src_r.id = src_v.recipe_id
   where src_r.organization_id = v_source;

  update public.recipes sim
     set current_version_id = (
       select sim_v.id from public.recipe_versions sim_v
        where sim_v.recipe_id = sim.id
        order by sim_v.version desc limit 1)
   where sim.organization_id = c_org;

  /*
   * Le stock d'ouverture.
   *
   * Des mouvements, pas des niveaux (RULE-002/003) : le stock reste une
   * projection, ici comme partout.
   *
   * Deux articles ouvrent volontairement SOUS leur minimum. Sans cela, la
   * liste de courses et les alertes de rupture ouvriraient la journée à vide
   * et la simulation ne dirait rien d'elles. Une matinée qui commence par un
   * manque, c'est la matinée normale.
   *
   * Les produits finis n'ont pas de stock : ils sont préparés à la commande.
   */
  insert into public.stock_movements (
    organization_id, site_id, location_id, item_id, quantity, unit,
    movement_type, reference_type, reference_id, user_id, device_id,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
  )
  select c_org, c_site, c_central, i.id,
         coalesce(manque.quantite, i.target_stock, 10), i.unit,
         'INITIAL', 'SimulationOpening', c_org,
         v_auteur, 'simulation',
         v_auteur, p.name, p.post, 'RUN_SIMULATION', now()
    from public.items i
    join public.profiles p on p.id = v_auteur
    left join (values
      ('Lait concentré',     2::numeric),
      ('Pack gobelet moyen', 1::numeric)
    ) as manque(nom, quantite) on manque.nom = i.name
   where i.organization_id = c_org
     and i.kind in ('RAW_MATERIAL', 'PACKAGING')
     and i.active
     and coalesce(manque.quantite, i.target_stock, 10) <> 0;
end $$;


-- ---------------------------------------------------------------------
-- 6. Entrer
-- ---------------------------------------------------------------------

create or replace function public.enter_simulation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_org       constant uuid := public.simulation_org_id();
  v_uid       uuid := auth.uid();
  v_home_org  uuid;
  v_home_site uuid;
begin
  if v_uid is null then
    raise exception 'Aucune session ouverte : impossible d''ouvrir une simulation.';
  end if;

  -- Revérifié ici et pas seulement à l'écran : c'est le serveur qui autorise.
  if not public.has_capability('RUN_SIMULATION') then
    raise exception 'Vous n''avez pas le droit d''ouvrir une simulation.';
  end if;

  select organization_id, site_id into v_home_org, v_home_site
    from public.profiles where id = v_uid;

  /*
   * Déjà dedans : ne rien faire, surtout pas réécrire `home_*`.
   *
   * Sans ce retour, un second appel enregistrerait le bac à sable comme maison
   * d'origine — et la personne n'aurait plus aucun endroit où revenir. C'est le
   * seul défaut de ce dispositif qui serait irréparable depuis l'application.
   */
  if v_home_org = c_org then
    return;
  end if;

  perform public.build_simulation();

  update public.profiles
     set organization_id      = c_org,
         site_id              = (select id from public.sites
                                  where organization_id = c_org
                                  order by created_at limit 1),
         home_organization_id = v_home_org,
         home_site_id         = v_home_site
   where id = v_uid;
end $$;


-- ---------------------------------------------------------------------
-- 7. Revenir
--
-- Aucune vérification de capacité, et c'est délibéré. Une capacité révoquée
-- pendant qu'on simule laisserait sinon la personne enfermée dans le bac à
-- sable. On peut refuser d'ouvrir une simulation ; on ne refuse pas à
-- quelqu'un de rentrer chez lui.
-- ---------------------------------------------------------------------

create or replace function public.leave_simulation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_home_org  uuid;
  v_home_site uuid;
begin
  if v_uid is null then
    raise exception 'Aucune session ouverte.';
  end if;

  select home_organization_id, home_site_id into v_home_org, v_home_site
    from public.profiles where id = v_uid;

  -- Déjà chez soi : rien à faire, et surtout pas d'erreur. Le bouton peut être
  -- pressé deux fois, ou l'être depuis un appareil en retard d'un aller-retour.
  if v_home_org is null then
    return;
  end if;

  update public.profiles
     set organization_id      = v_home_org,
         site_id              = v_home_site,
         home_organization_id = null,
         home_site_id         = null
   where id = v_uid;
end $$;


-- ---------------------------------------------------------------------
-- 8. Effacer
--
-- Ramène TOUT LE MONDE chez soi avant de supprimer. Ce n'est pas une
-- politesse : `profiles.organization_id` cascade depuis `organizations`, donc
-- supprimer le bac à sable pendant qu'un profil le désigne DÉTRUIRAIT le
-- compte. L'ordre des deux gestes est la seule chose qui l'empêche.
-- ---------------------------------------------------------------------

create or replace function public.purge_simulation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_org constant uuid := public.simulation_org_id();
  v_nom text;
begin
  if auth.uid() is null then
    raise exception 'Aucune session ouverte.';
  end if;
  if not public.has_capability('RUN_SIMULATION') then
    raise exception 'Vous n''avez pas le droit d''effacer une simulation.';
  end if;

  select name into v_nom from public.organizations where id = c_org;
  if v_nom is null then
    return;   -- Rien à effacer.
  end if;

  /*
   * Le garde-fou. On ne supprime pas « l'organisation dont l'identifiant est
   * c_org » : on supprime « celle qui s'appelle BUNA — Simulation ». Si les
   * deux ne coïncident pas, quelqu'un a réutilisé l'identifiant et la suite
   * serait une destruction de données réelles.
   */
  if v_nom is distinct from 'BUNA — Simulation' then
    raise exception
      'REFUS : l''organisation % s''appelle « % ». Rien n''a été supprimé.', c_org, v_nom;
  end if;

  -- D'abord les personnes.
  update public.profiles
     set organization_id      = home_organization_id,
         site_id              = home_site_id,
         home_organization_id = null,
         home_site_id         = null
   where home_organization_id is not null;

  /*
   * Puis les tables de lignes.
   *
   * Cinq d'entre elles référencent `items` en NO ACTION sans porter
   * d'`organization_id` : la cascade depuis `organizations` supprime `items` ET
   * leur table parente dans la même instruction, sans garantie que la ligne
   * fille soit partie avant que la contrainte sur `items` ne soit vérifiée. La
   * suppression échouerait sur « violates foreign key constraint
   * sale_lines_item_id_fkey » — un défaut invisible sur un bac à sable vide, et
   * systématique dès qu'on y a vendu quelque chose.
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
      where r.organization_id = c_org);

  -- Enfin l'organisation. La cascade emporte le reste.
  delete from public.organizations where id = c_org;
end $$;


-- ---------------------------------------------------------------------
-- 9. Privilèges
--
-- PostgreSQL accorde `execute` à PUBLIC par défaut : un `revoke ... from anon`
-- seul ne ferait rien. On révoque de `public`, puis on accorde nommément.
--
-- `build_simulation` n'est accordée à PERSONNE : elle crée une organisation, et
-- seule `enter_simulation` doit pouvoir le faire — ce qu'elle peut, étant
-- SECURITY DEFINER.
--
-- Rien n'est accordé à `anon` : les trois fonctions exigent `auth.uid()`.
-- ---------------------------------------------------------------------

revoke execute on function public.build_simulation()   from public;
revoke execute on function public.enter_simulation()   from public;
revoke execute on function public.leave_simulation()   from public;
revoke execute on function public.purge_simulation()   from public;
revoke execute on function public.simulation_org_id()  from public;

grant execute on function public.enter_simulation()  to authenticated;
grant execute on function public.leave_simulation()  to authenticated;
grant execute on function public.purge_simulation()  to authenticated;
grant execute on function public.simulation_org_id() to authenticated;
