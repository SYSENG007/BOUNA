-- =====================================================================
-- BUNA Operations — transactions métier atomiques (§81) et idempotence (§56)
-- Si une étape échoue, rien n'est écrit. Une vente ne peut pas exister
-- sans ses mouvements de stock, son COGS et sa trace d'audit.
-- =====================================================================

-- Coût moyen pondéré : recalculé à chaque réception, jamais saisi.
create or replace function apply_weighted_average_cost(
  p_item_id uuid,
  p_incoming_qty numeric,
  p_incoming_unit_cost numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_qty numeric;
  v_current_cost numeric;
  v_new_cost numeric;
begin
  select coalesce(sum(quantity), 0) into v_current_qty
    from stock_levels where item_id = p_item_id;

  select weighted_avg_cost into v_current_cost from items where id = p_item_id;

  if v_current_qty <= 0 or coalesce(v_current_cost, 0) <= 0 then
    v_new_cost := p_incoming_unit_cost;
  else
    v_new_cost := (v_current_qty * v_current_cost + p_incoming_qty * p_incoming_unit_cost)
                  / nullif(v_current_qty + p_incoming_qty, 0);
  end if;

  update items set weighted_avg_cost = v_new_cost where id = p_item_id;
  return v_new_cost;
end;
$$;

-- ---------------------------------------------------------------------
-- complete_sale — Sale + SaleLines + Payment + StockMovements + COGS
--                 + AuditEvent + DomainEvent, en une seule transaction.
--
-- p_event_id est l'UUID généré par le client AVANT connexion. Il porte
-- l'idempotence : rejouer l'appel après un retry réseau renvoie la vente
-- déjà créée au lieu d'en créer une seconde.
-- ---------------------------------------------------------------------
create or replace function complete_sale(
  p_event_id uuid,
  p_site_id uuid,
  p_location_id uuid,
  p_cash_session_id uuid,
  p_payment_method text,
  p_amount_received numeric,
  p_lines jsonb,          -- [{item_id, name, quantity, unit_price, unit_cost}]
  p_created_at_local timestamptz,
  p_device_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_user uuid := auth.uid();
  v_role user_role;
  v_sale_id uuid;
  v_existing uuid;
  v_number bigint;
  v_total numeric := 0;
  v_cogs numeric := 0;
  v_line jsonb;
  v_user_name text;
begin
  -- Idempotence : l'événement a-t-il déjà été traité ?
  select entity_id into v_existing from domain_events
    where id = p_event_id and event_type = 'SALE_COMPLETED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from profiles where id = v_user;

  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  -- Permission revalidée côté serveur, pas seulement dans l'UI.
  if v_role not in ('SELLER','MANAGER','OWNER') then
    raise exception 'Rôle % non autorisé à enregistrer une vente', v_role;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total := v_total + (v_line->>'quantity')::numeric * (v_line->>'unit_price')::numeric;
    v_cogs  := v_cogs  + (v_line->>'quantity')::numeric * (v_line->>'unit_cost')::numeric;
  end loop;

  select coalesce(max(number), 0) + 1 into v_number from sales where organization_id = v_org;

  insert into sales (
    organization_id, site_id, location_id, cash_session_id, seller_id,
    number, total, cogs, payment_method, amount_received, status, created_at
  ) values (
    v_org, p_site_id, p_location_id, p_cash_session_id, v_user,
    v_number, v_total, v_cogs, p_payment_method, p_amount_received, 'COMPLETED',
    coalesce(p_created_at_local, now())
  ) returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into sale_lines (sale_id, item_id, name, quantity, unit_price, unit_cost)
    values (
      v_sale_id,
      (v_line->>'item_id')::uuid,
      v_line->>'name',
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      (v_line->>'unit_cost')::numeric
    );

    -- Le stock baisse par un mouvement, jamais par un UPDATE de niveau.
    insert into stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id, device_id
    )
    select
      v_org, p_site_id, p_location_id, (v_line->>'item_id')::uuid,
      -((v_line->>'quantity')::numeric), i.unit,
      'SALE', 'Sale', v_sale_id, v_user, p_device_id
    from items i where i.id = (v_line->>'item_id')::uuid;
  end loop;

  insert into domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'SALE_COMPLETED', 'Sale', v_sale_id,
    v_user, p_device_id,
    jsonb_build_object('total', v_total, 'cogs', v_cogs, 'lines', p_lines),
    coalesce(p_created_at_local, now())
  );

  insert into audit_events (
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
-- void_sale — RULE-001 : on n'efface pas, on compense avec un motif.
-- ---------------------------------------------------------------------
create or replace function void_sale(
  p_event_id uuid,
  p_sale_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role user_role; v_user_name text;
  v_sale sales%rowtype;
begin
  if exists (select 1 from domain_events where id = p_event_id) then
    return; -- déjà traité
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : un motif est obligatoire';
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from profiles where id = v_user;

  if v_role not in ('MANAGER','OWNER') then
    raise exception 'Rôle % non autorisé à annuler une vente', v_role;
  end if;

  select * into v_sale from sales where id = p_sale_id and organization_id = v_org;
  if v_sale.id is null then
    raise exception 'Vente introuvable';
  end if;
  if v_sale.status <> 'COMPLETED' then
    raise exception 'Vente déjà annulée ou remboursée';
  end if;

  update sales
     set status = 'VOIDED', void_reason = p_reason, voided_by = v_user
   where id = p_sale_id;

  -- Mouvements inverses : le stock revient, la trace reste.
  insert into stock_movements (
    organization_id, site_id, location_id, item_id, quantity, unit,
    movement_type, reference_type, reference_id, user_id
  )
  select v_org, v_sale.site_id, v_sale.location_id, sl.item_id, sl.quantity, i.unit,
         'RETURN', 'SaleVoid', p_sale_id, v_user
    from sale_lines sl join items i on i.id = sl.item_id
   where sl.sale_id = p_sale_id;

  insert into domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, payload, created_at_local
  ) values (
    p_event_id, v_org, v_sale.site_id, 'SALE_CANCELLED', 'Sale', p_sale_id,
    v_user, jsonb_build_object('reason', p_reason), now()
  );

  insert into audit_events (organization_id, user_id, user_name, role, action, detail, reference)
  values (v_org, v_user, v_user_name, v_role,
          format('Annulation vente #%s', v_sale.number),
          format('motif : %s', p_reason), format('sale:%s', v_sale.number));
end;
$$;

-- ---------------------------------------------------------------------
-- receive_goods — réception : stock + coût moyen pondéré + dépense.
-- §21 : la réception peut être partielle et reste distincte de la commande.
-- ---------------------------------------------------------------------
create or replace function receive_goods(
  p_event_id uuid,
  p_site_id uuid,
  p_location_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,           -- [{item_id, quantity, unit, unit_price}]
  p_transport_cost numeric,
  p_payment_method text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role user_role; v_user_name text;
  v_purchase_id uuid; v_line jsonb; v_goods numeric := 0;
begin
  select entity_id into v_purchase_id from domain_events
    where id = p_event_id and event_type = 'GOODS_RECEIVED';
  if v_purchase_id is not null then
    return v_purchase_id;
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from profiles where id = v_user;

  if v_role not in ('PROCUREMENT','MANAGER','OWNER') then
    raise exception 'Rôle % non autorisé à réceptionner', v_role;
  end if;

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

  insert into audit_events (organization_id, user_id, user_name, role, action, detail)
  values (v_org, v_user, v_user_name, v_role, 'Réception marchandise',
          format('%s ligne(s) · %s FCFA', jsonb_array_length(p_lines),
                 v_goods + coalesce(p_transport_cost, 0)));

  return v_purchase_id;
end;
$$;
