-- =====================================================================
-- BUNA Operations — 0011 : rattrapage des objets manquants de 0008
--
-- Constat fait en appliquant 0009 sur la base réelle : `complete_sale`
-- référence `items.production_mode` et `made_to_order_unit_cost()`, qui
-- n'existent pas. La sauvegarde d'avant migration le confirme — 0008
-- n'a jamais été appliquée à ce projet, alors que 0009 embarquait la
-- version de `complete_sale` qui en dépend. Toute vente échouait donc.
--
-- Ce fichier ajoute UNIQUEMENT les objets structurels de 0008 : l'enum,
-- les deux colonnes, l'index et les cinq fonctions de conversion. Il ne
-- reprend PAS les réécritures de `complete_sale`, `void_sale` et
-- `recommended_production` de 0008 : celles-ci gardent par le rôle, et
-- les réappliquer écraserait les gardes par capacité de 0009.
-- =====================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'production_mode') then
    create type public.production_mode as enum ('BATCH','MADE_TO_ORDER');
  end if;
end $$;

alter table public.items
  add column if not exists production_mode public.production_mode not null default 'BATCH';

comment on column public.items.production_mode is
  'BATCH : produit d''avance, entre en stock. MADE_TO_ORDER : monte a la commande, la vente deduit les ingredients.';

-- La recette pointait sa version courante côté client seulement ; sans ce
-- lien en base, le serveur ne sait pas quelle version appliquer à la vente.
alter table public.recipes
  add column if not exists current_version_id uuid references public.recipe_versions(id);

create index if not exists idx_recipes_current_version on public.recipes (current_version_id);

-- ---------------------------------------------------------------------
-- Conversion d'unités — même table que `UNIT_BASE` côté TypeScript.
-- Le stock d'un article s'exprime toujours dans SON unité : une recette
-- qui demande 200 mL de lait consomme 0,2 L si le lait se compte en litres.
-- ---------------------------------------------------------------------
create or replace function public.unit_base(u public.unit_code)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case u
    when 'kg' then 'g' when 'g' then 'g'
    when 'L'  then 'mL' when 'mL' then 'mL'
    else 'unite' end;
$$;

create or replace function public.unit_factor(u public.unit_code)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case u when 'kg' then 1000 when 'L' then 1000 else 1 end::numeric;
$$;

create or replace function public.convert_qty(
  p_quantity numeric, p_from public.unit_code, p_to public.unit_code
) returns numeric
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if public.unit_base(p_from) <> public.unit_base(p_to) then
    raise exception 'Conversion impossible de % vers % : familles d''unités différentes', p_from, p_to;
  end if;
  return p_quantity * public.unit_factor(p_from) / public.unit_factor(p_to);
end;
$$;

-- ---------------------------------------------------------------------
-- Version de recette applicable : celle marquée courante, sinon la plus
-- récente. Une recette sans version n'est pas une erreur — c'est un
-- article qu'on vend sans le fabriquer.
-- ---------------------------------------------------------------------
create or replace function public.current_recipe_version(p_item_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    r.current_version_id,
    (select rv.id from public.recipe_versions rv
      where rv.recipe_id = r.id order by rv.version desc limit 1))
  from public.recipes r
  where r.item_id = p_item_id
  order by r.id
  limit 1;
$$;

-- Coût d'un produit monté à la commande : la somme de ses ingrédients au
-- coût moyen pondéré du moment. Dérivé, jamais saisi.
create or replace function public.made_to_order_unit_cost(p_item_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    public.convert_qty(ri.quantity, ri.unit, ing.unit) * coalesce(ing.weighted_avg_cost, 0)
  ), 0)
  from public.recipe_ingredients ri
  join public.items ing on ing.id = ri.item_id
  where ri.recipe_version_id = public.current_recipe_version(p_item_id);
$$;

commit;
