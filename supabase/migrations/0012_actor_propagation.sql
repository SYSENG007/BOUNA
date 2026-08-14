-- =====================================================================
-- BUNA Operations — 0012 : l'estampille d'auteur atteint enfin la base
--
-- 0010 a ajouté les colonnes actor_* sur sept tables. Aucune fonction ne les
-- renseignait : seul `seller_id` était écrit. Une vente relue depuis le serveur
-- s'affichait donc « Auteur inconnu », et la traçabilité — l'objet même de la
-- refonte — restait locale à l'appareil qui avait saisi.
--
-- Deux pièces :
--   1. chaque fonction gardée pose la capacité qu'elle vient de vérifier dans
--      un réglage local à la transaction ;
--   2. un déclencheur BEFORE INSERT estampille qui, quand, à quel poste et
--      sous quelle capacité — uniquement si l'appelant ne l'a pas déjà fait,
--      pour que le client hors ligne garde la main sur sa propre estampille.
--
-- On ne déduit JAMAIS la capacité du poste : ce serait inventer une
-- autorisation. Sans réglage posé, actor_capability reste nul, et c'est
-- honnête.
-- =====================================================================

begin;

create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $stamp$
declare
  v_user uuid := auth.uid();
  v_cap  text := nullif(current_setting('buna.capability', true), '');
begin
  if new.actor_user_id is null and v_user is not null then
    new.actor_user_id := v_user;
    select p.name, p.post into new.actor_user_name, new.actor_post
      from public.profiles p where p.id = v_user;
  end if;

  if new.actor_capability is null and v_cap is not null then
    new.actor_capability := v_cap::public.capability;
  end if;

  return new;
end;
$stamp$;

revoke execute on function public.stamp_actor() from public;

drop trigger if exists stamp_actor_on_sales on public.sales;
create trigger stamp_actor_on_sales
  before insert on public.sales
  for each row execute function public.stamp_actor();
drop trigger if exists stamp_actor_on_stock_movements on public.stock_movements;
create trigger stamp_actor_on_stock_movements
  before insert on public.stock_movements
  for each row execute function public.stamp_actor();
drop trigger if exists stamp_actor_on_production_batches on public.production_batches;
create trigger stamp_actor_on_production_batches
  before insert on public.production_batches
  for each row execute function public.stamp_actor();
drop trigger if exists stamp_actor_on_purchases on public.purchases;
create trigger stamp_actor_on_purchases
  before insert on public.purchases
  for each row execute function public.stamp_actor();
drop trigger if exists stamp_actor_on_expenses on public.expenses;
create trigger stamp_actor_on_expenses
  before insert on public.expenses
  for each row execute function public.stamp_actor();
drop trigger if exists stamp_actor_on_waste_events on public.waste_events;
create trigger stamp_actor_on_waste_events
  before insert on public.waste_events
  for each row execute function public.stamp_actor();
drop trigger if exists stamp_actor_on_inventory_counts on public.inventory_counts;
create trigger stamp_actor_on_inventory_counts
  before insert on public.inventory_counts
  for each row execute function public.stamp_actor();

-- Fonctions gardées : pose de la capacité exercée.

-- complete_sale → SELL
CREATE OR REPLACE FUNCTION public.complete_sale(p_event_id uuid, p_site_id uuid, p_location_id uuid, p_cash_session_id uuid, p_payment_method text, p_amount_received numeric, p_lines jsonb, p_created_at_local timestamp with time zone, p_device_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'SELL', true);

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
$function$;

-- void_sale → VOID_SALE
CREATE OR REPLACE FUNCTION public.void_sale(p_event_id uuid, p_sale_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'VOID_SALE', true);

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
$function$;

-- receive_goods → RECEIVE_GOODS
CREATE OR REPLACE FUNCTION public.receive_goods(p_event_id uuid, p_site_id uuid, p_location_id uuid, p_supplier_id uuid, p_lines jsonb, p_transport_cost numeric, p_payment_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'RECEIVE_GOODS', true);

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
$function$;

-- request_purchase → REQUEST_PURCHASE
CREATE OR REPLACE FUNCTION public.request_purchase(p_event_id uuid, p_site_id uuid, p_supplier_id uuid, p_lines jsonb, p_needed_by date DEFAULT NULL::date, p_priority text DEFAULT 'NORMALE'::text, p_justification text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'REQUEST_PURCHASE', true);

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
$function$;

-- approve_purchase_request → APPROVE_PURCHASE
CREATE OR REPLACE FUNCTION public.approve_purchase_request(p_event_id uuid, p_purchase_order_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'APPROVE_PURCHASE', true);

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
$function$;

-- reject_purchase_request → APPROVE_PURCHASE
CREATE OR REPLACE FUNCTION public.reject_purchase_request(p_event_id uuid, p_purchase_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'APPROVE_PURCHASE', true);

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
$function$;

-- place_purchase_order → PLACE_ORDER
CREATE OR REPLACE FUNCTION public.place_purchase_order(p_event_id uuid, p_purchase_order_id uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_expected_delivery_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'PLACE_ORDER', true);

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
$function$;

-- receive_purchase_order → RECEIVE_GOODS
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_event_id uuid, p_purchase_order_id uuid, p_location_id uuid, p_lines jsonb, p_transport_cost numeric DEFAULT 0, p_payment_method text DEFAULT 'CASH'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'RECEIVE_GOODS', true);

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
$function$;

-- recommended_production → PRODUCE
CREATE OR REPLACE FUNCTION public.recommended_production(p_site_id uuid, p_horizon_hours integer DEFAULT 12, p_lookback_days integer DEFAULT 14)
 RETURNS TABLE(item_id uuid, name text, unit unit_code, sold_per_day numeric, on_hand numeric, cover_hours numeric, recommended_quantity numeric, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  -- C'est elle que le déclencheur d'estampille lira : la déduire du poste
  -- fabriquerait une autorisation qui n'a peut-être jamais existé.
  perform set_config('buna.capability', 'PRODUCE', true);

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
$function$;

commit;
