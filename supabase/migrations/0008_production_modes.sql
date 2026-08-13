-- =====================================================================
-- BUNA Operations — production à la commande et production recommandée
-- Sprint 3 (§27-B, §29)
--
-- Deux façons de fabriquer coexistent au comptoir :
--   • le batch    — on prépare vingt cold brew le matin, ils entrent en
--                   stock, la vente les décrémente ;
--   • à la commande — le latte se monte devant le client. Rien n'entre en
--                   stock : ce sont le lait, le café et le gobelet qui
--                   sortent, au moment de la vente.
-- Le second mode n'est pas un cas particulier de l'écran de vente : c'est
-- une propriété de l'article, et c'est `complete_sale` qui en tient compte.
-- =====================================================================

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

-- ---------------------------------------------------------------------
-- complete_sale — réécriture : même signature, même idempotence.
--
-- Seul le mouvement de stock change. Pour un article BATCH, la vente
-- sort le produit fini. Pour un article MADE_TO_ORDER, elle sort chaque
-- ingrédient de la recette : c'est la préparation qui a lieu, pas un
-- prélèvement dans un stock de produits finis qui n'existe pas.
--
-- Un article à la commande sans recette retombe sur le mouvement de
-- produit fini : RULE-010, une vente ne doit jamais échouer au comptoir
-- à cause d'une donnée de catalogue incomplète.
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
  v_role public.user_role;
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

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;

  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if v_role not in ('SELLER','MANAGER','OWNER') then
    raise exception 'Rôle % non autorisé à enregistrer une vente', v_role;
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
    organization_id, user_id, user_name, role, action, detail, reference, device_id
  ) values (
    v_org, v_user, v_user_name, v_role,
    format('Vente #%s — %s FCFA', v_number, v_total),
    format('%s ligne(s) · %s', jsonb_array_length(p_lines), p_payment_method),
    format('sale:%s', v_number), p_device_id
  );

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- void_sale — l'annulation doit rendre exactement ce que la vente a pris.
-- Un produit monté à la commande a consommé des ingrédients : ce sont eux
-- qui reviennent, pas un produit fini qui n'a jamais existé en stock.
-- ---------------------------------------------------------------------
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
  v_org uuid; v_user uuid := auth.uid(); v_role public.user_role; v_user_name text;
  v_sale public.sales%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : un motif est obligatoire';
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;

  if v_role not in ('MANAGER','OWNER') then
    raise exception 'Rôle % non autorisé à annuler une vente', v_role;
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

  insert into public.audit_events (organization_id, user_id, user_name, role, action, detail, reference)
  values (v_org, v_user, v_user_name, v_role,
          format('Annulation vente #%s', v_sale.number),
          format('motif : %s', p_reason), format('sale:%s', v_sale.number));
end;
$$;

-- ---------------------------------------------------------------------
-- recommended_production (§29) — « combien j'en prépare maintenant ? »
--
-- La réponse tient en trois nombres : la vitesse de vente observée, ce
-- qui reste au comptoir, et l'horizon qu'on veut couvrir. Rien de plus.
--
-- SECURITY DEFINER assumé : la politique `sales_read` limite un vendeur à
-- ses propres ventes, et un préparateur n'en voit aucune — il ne pourrait
-- donc pas calculer la vitesse de vente, alors que c'est exactement lui
-- qui en a besoin. La fonction ne rend que des agrégats, filtre sur
-- l'organisation de l'appelant, et vérifie son rôle.
-- ---------------------------------------------------------------------
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
  v_org uuid; v_role public.user_role;
begin
  select organization_id, role into v_org, v_role
    from public.profiles where id = auth.uid();

  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;
  if v_role not in ('PREPARER','MANAGER','OWNER','PROCUREMENT') then
    raise exception 'Rôle % non concerné par la production', v_role;
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

-- ---------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------
revoke execute on function public.recommended_production(uuid, int, int)  from public, anon;
revoke execute on function public.made_to_order_unit_cost(uuid)           from public, anon;
revoke execute on function public.current_recipe_version(uuid)            from public, anon;
revoke execute on function public.convert_qty(numeric, public.unit_code, public.unit_code) from public, anon;
revoke execute on function public.unit_base(public.unit_code)             from public, anon;
revoke execute on function public.unit_factor(public.unit_code)           from public, anon;

grant execute on function public.recommended_production(uuid, int, int)   to authenticated;
grant execute on function public.made_to_order_unit_cost(uuid)            to authenticated;
grant execute on function public.current_recipe_version(uuid)             to authenticated;
grant execute on function public.convert_qty(numeric, public.unit_code, public.unit_code) to authenticated;
grant execute on function public.unit_base(public.unit_code)              to authenticated;
grant execute on function public.unit_factor(public.unit_code)            to authenticated;
