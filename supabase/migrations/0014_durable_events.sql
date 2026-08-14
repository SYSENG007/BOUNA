-- 0014 — Les événements durables.
--
-- Ce fichier est le RELEVÉ des fonctions réellement en production, pas une
-- proposition. Elles y ont été appliquées hors du chemin normal ; le dépôt les
-- rattrape ici pour qu'une base reconstruite depuis `supabase/migrations/`
-- redonne exactement la base actuelle.
--
-- Elles ferment la perte silencieuse décrite dans le bilan de production :
-- douze types d'événements sur quinze arrivaient dans `domain_events` sans
-- qu'aucune projection ne les rejoue, et l'hydratation suivante les effaçait.
-- Chacune commence par son contrôle d'idempotence sur `p_event_id` (RULE-004),
-- est gardée par `has_capability()`, et n'écrit jamais de niveau de stock —
-- uniquement des `stock_movements` (RULE-002 / RULE-003).
--
-- `record_payment` et `resolve_variance`, présentes dans le brouillon initial,
-- ne sont volontairement PAS ici : le paiement est déjà porté par
-- `complete_sale` — l'écrire deux fois doublerait l'encaissement.


CREATE FUNCTION public.record_waste(p_event_id uuid, p_waste_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_quantity numeric, p_unit text, p_cost numeric, p_reason text, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_waste_id uuid; v_existing uuid; v_at timestamptz; v_unit public.unit_code;
  v_item_name text;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'WASTE_RECORDED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('RECORD_WASTE') then
    raise exception 'Vous n''avez pas l''autorisation de déclarer une perte.'
      using errcode = '42501';
  end if;

  -- La capacité effectivement exercée, posée pour la durée de la transaction.
  perform set_config('buna.capability', 'RECORD_WASTE', true);

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : une perte déclarée dit toujours pourquoi';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Une perte porte sur une quantité positive';
  end if;

  v_at       := coalesce(p_created_at_local, now());
  v_unit     := p_unit::public.unit_code;
  v_waste_id := coalesce(p_waste_id, gen_random_uuid());

  insert into public.waste_events (
    id, organization_id, item_id, location_id, quantity, unit, cost, reason,
    user_id, created_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at, device_id
  ) values (
    v_waste_id, v_org, p_item_id, p_location_id, p_quantity, v_unit,
    coalesce(p_cost, 0), p_reason, v_user, v_at,
    v_user, v_user_name, v_post, 'RECORD_WASTE', v_at, p_device_id
  );

  -- RULE-002 : la perte ne « baisse » aucun niveau, elle sort du stock.
  insert into public.stock_movements (
    organization_id, site_id, location_id, item_id, quantity, unit,
    movement_type, reference_type, reference_id, user_id, device_id, created_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
  ) values (
    v_org, p_site_id, p_location_id, p_item_id, -p_quantity, v_unit,
    'WASTE', 'WasteEvent', v_waste_id, v_user, p_device_id, v_at,
    v_user, v_user_name, v_post, 'RECORD_WASTE', v_at
  );

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'WASTE_RECORDED', 'WasteEvent', v_waste_id,
    v_user, p_device_id,
    jsonb_build_object('itemId', p_item_id, 'locationId', p_location_id,
                       'quantity', p_quantity, 'unit', p_unit,
                       'cost', coalesce(p_cost, 0), 'reason', p_reason),
    v_at
  );

  select name into v_item_name from public.items where id = p_item_id;

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Perte déclarée — %s', coalesce(v_item_name, 'article')),
    format('%s %s · motif : %s · %s FCFA',
           p_quantity, p_unit, p_reason, round(coalesce(p_cost, 0))),
    format('waste:%s', left(v_waste_id::text, 8)),
    p_device_id, 'RECORD_WASTE', v_at
  );

  return v_waste_id;
end;
$$;

CREATE FUNCTION public.transfer_stock(p_event_id uuid, p_transfer_id uuid, p_site_id uuid, p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_unit text, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_transfer_id uuid; v_existing uuid; v_at timestamptz; v_unit public.unit_code;
  v_item_name text;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'STOCK_TRANSFERRED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('TRANSFER_STOCK') then
    raise exception 'Vous n''avez pas l''autorisation de transférer du stock.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'TRANSFER_STOCK', true);

  if p_from_location_id = p_to_location_id then
    raise exception 'Un transfert va d''un emplacement vers un autre';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Un transfert porte sur une quantité positive';
  end if;

  v_at          := coalesce(p_created_at_local, now());
  v_unit        := p_unit::public.unit_code;
  v_transfer_id := coalesce(p_transfer_id, gen_random_uuid());

  insert into public.stock_movements (
    organization_id, site_id, location_id, item_id, quantity, unit,
    movement_type, reference_type, reference_id, user_id, device_id, created_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
  )
  select v_org, p_site_id, loc, p_item_id, qty, v_unit,
         kind, 'Transfer', v_transfer_id, v_user, p_device_id, v_at,
         v_user, v_user_name, v_post, 'TRANSFER_STOCK', v_at
    from (values
      (p_from_location_id, -p_quantity, 'TRANSFER_OUT'::public.movement_type),
      (p_to_location_id,    p_quantity, 'TRANSFER_IN'::public.movement_type)
    ) as t(loc, qty, kind);

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'STOCK_TRANSFERRED', 'Transfer', v_transfer_id,
    v_user, p_device_id,
    jsonb_build_object('itemId', p_item_id, 'from', p_from_location_id,
                       'to', p_to_location_id, 'quantity', p_quantity, 'unit', p_unit),
    v_at
  );

  select name into v_item_name from public.items where id = p_item_id;

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Transfert — %s', coalesce(v_item_name, 'article')),
    format('%s %s', p_quantity, p_unit),
    format('transfer:%s', left(v_transfer_id::text, 8)),
    p_device_id, 'TRANSFER_STOCK', v_at
  );

  return v_transfer_id;
end;
$$;

CREATE FUNCTION public.apply_inventory_count(p_event_id uuid, p_count_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_unit text, p_theoretical numeric, p_counted numeric, p_delta numeric, p_reason text, p_variance_id uuid DEFAULT NULL::uuid, p_variance_amount numeric DEFAULT 0, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_count_id uuid; v_existing uuid; v_at timestamptz; v_unit public.unit_code;
  v_delta numeric; v_item_name text;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'STOCK_COUNTED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('COUNT_INVENTORY') then
    raise exception 'Vous n''avez pas l''autorisation de compter un emplacement.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'COUNT_INVENTORY', true);

  v_delta := coalesce(p_delta, coalesce(p_counted, 0) - coalesce(p_theoretical, 0));

  if v_delta <> 0 and coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : un écart de comptage dit toujours pourquoi';
  end if;

  v_at       := coalesce(p_created_at_local, now());
  v_unit     := p_unit::public.unit_code;
  v_count_id := coalesce(p_count_id, gen_random_uuid());
  select name into v_item_name from public.items where id = p_item_id;

  insert into public.inventory_counts (
    id, organization_id, location_id, user_id, status, created_at, validated_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at, device_id
  ) values (
    v_count_id, v_org, p_location_id, v_user, 'VALIDATED', v_at, v_at,
    v_user, v_user_name, v_post, 'COUNT_INVENTORY', v_at, p_device_id
  )
  on conflict (id) do nothing;

  -- `variance` est une colonne générée (compté − théorique) : l'écrire
  -- lèverait 428C9. Le serveur la calcule, on ne la déclare pas.
  insert into public.inventory_count_lines (
    inventory_count_id, item_id, theoretical, counted, reason
  ) values (
    v_count_id, p_item_id, coalesce(p_theoretical, 0), coalesce(p_counted, 0),
    nullif(trim(coalesce(p_reason, '')), '')
  );

  -- Un comptage conforme ne produit pas de mouvement : le journal du stock
  -- ne se remplit pas de lignes à zéro (la table les refuse, d'ailleurs).
  if v_delta <> 0 then
    insert into public.stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id, device_id, created_at,
      actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
    ) values (
      v_org, p_site_id, p_location_id, p_item_id, v_delta, v_unit,
      'ADJUSTMENT', 'InventoryCount', v_count_id, v_user, p_device_id, v_at,
      v_user, v_user_name, v_post, 'COUNT_INVENTORY', v_at
    );

    if p_variance_id is not null then
      insert into public.variances (
        id, organization_id, site_id, source, reference_id, subject,
        theoretical, declared, delta, amount,
        actor_user_id, actor_user_name, actor_post, actor_capability, created_at
      ) values (
        p_variance_id, v_org, p_site_id, 'STOCK', v_count_id,
        coalesce(v_item_name, 'article'),
        coalesce(p_theoretical, 0), coalesce(p_counted, 0), v_delta,
        abs(coalesce(p_variance_amount, 0)),
        v_user, v_user_name, v_post, 'COUNT_INVENTORY', v_at
      )
      on conflict (id) do nothing;
    end if;
  end if;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'STOCK_COUNTED', 'InventoryCount', v_count_id,
    v_user, p_device_id,
    jsonb_build_object('itemId', p_item_id, 'locationId', p_location_id, 'unit', p_unit,
                       'theoretical', p_theoretical, 'counted', p_counted,
                       'delta', v_delta, 'reason', p_reason),
    v_at
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Inventaire — %s', coalesce(v_item_name, 'article')),
    format('théorique %s · compté %s · écart %s %s · motif : %s',
           round(coalesce(p_theoretical, 0), 2), p_counted,
           case when v_delta > 0 then '+' else '' end || round(v_delta, 2), p_unit,
           coalesce(p_reason, '—')),
    format('count:%s', left(v_count_id::text, 8)),
    p_device_id, 'COUNT_INVENTORY', v_at
  );

  return v_count_id;
end;
$$;

CREATE FUNCTION public.complete_batch(p_event_id uuid, p_batch_id uuid, p_site_id uuid, p_code text, p_item_id uuid, p_recipe_version_id uuid, p_location_id uuid, p_planned numeric, p_produced numeric, p_loss numeric, p_consumption jsonb DEFAULT '[]'::jsonb, p_variance_id uuid DEFAULT NULL::uuid, p_variance_amount numeric DEFAULT 0, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_batch_id uuid; v_existing uuid; v_at timestamptz;
  v_version uuid; v_item_unit public.unit_code; v_item_name text;
  v_yield numeric;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'BATCH_COMPLETED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('PRODUCE') then
    raise exception 'Vous n''avez pas l''autorisation de lancer une préparation.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'PRODUCE', true);

  if coalesce(p_produced, 0) <= 0 then
    raise exception 'Une préparation produit une quantité positive';
  end if;

  select unit, name into v_item_unit, v_item_name from public.items where id = p_item_id;

  -- `production_batches.recipe_version_id` est obligatoire ET référencé :
  -- sans recette en base, la préparation n'a nulle part où s'inscrire. On le
  -- dit franchement plutôt que d'inventer une version qui n'existe pas.
  v_version := coalesce(p_recipe_version_id, public.current_recipe_version(p_item_id));
  if v_version is null then
    -- `raise` interpole avec %, pas %s : un %s ici laisserait un « s » orphelin
    -- dans le message que l'utilisateur lira.
    raise exception 'Aucune recette enregistrée pour « % » : la préparation ne peut pas être conservée. Créez la recette, puis relancez.',
      coalesce(v_item_name, 'ce produit');
  end if;

  v_at       := coalesce(p_created_at_local, now());
  v_batch_id := coalesce(p_batch_id, gen_random_uuid());

  insert into public.production_batches (
    id, organization_id, site_id, code, item_id, recipe_version_id, preparer_id,
    location_id, planned_quantity, produced_quantity, loss_quantity,
    started_at, completed_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at, device_id
  ) values (
    v_batch_id, v_org, p_site_id, p_code, p_item_id, v_version, v_user,
    p_location_id, coalesce(p_planned, p_produced), p_produced, coalesce(p_loss, 0),
    v_at, v_at,
    v_user, v_user_name, v_post, 'PRODUCE', v_at, p_device_id
  );

  -- Ce qui sort de la préparation.
  insert into public.stock_movements (
    organization_id, site_id, location_id, item_id, quantity, unit,
    movement_type, reference_type, reference_id, user_id, device_id, created_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
  ) values (
    v_org, p_site_id, p_location_id, p_item_id, p_produced,
    coalesce(v_item_unit, 'unite'),
    'PRODUCTION_OUTPUT', 'ProductionBatch', v_batch_id, v_user, p_device_id, v_at,
    v_user, v_user_name, v_post, 'PRODUCE', v_at
  );

  -- Ce qu'elle a consommé, tel que le préparateur l'a constaté.
  if jsonb_array_length(coalesce(p_consumption, '[]'::jsonb)) > 0 then
    insert into public.stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id, device_id, created_at,
      actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
    )
    select v_org, p_site_id,
           (line->>'location_id')::uuid, (line->>'item_id')::uuid,
           -(line->>'quantity')::numeric, (line->>'unit')::public.unit_code,
           'PRODUCTION_CONSUMPTION', 'ProductionBatch', v_batch_id, v_user, p_device_id, v_at,
           v_user, v_user_name, v_post, 'PRODUCE', v_at
      from jsonb_array_elements(p_consumption) as line
     where coalesce((line->>'quantity')::numeric, 0) <> 0;
  else
    insert into public.stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id, device_id, created_at,
      actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
    )
    select v_org, p_site_id, p_location_id, ri.item_id,
           -public.convert_qty(ri.quantity, ri.unit, ing.unit) * p_produced,
           ing.unit,
           'PRODUCTION_CONSUMPTION', 'ProductionBatch', v_batch_id, v_user, p_device_id, v_at,
           v_user, v_user_name, v_post, 'PRODUCE', v_at
      from public.recipe_ingredients ri
      join public.items ing on ing.id = ri.item_id
     where ri.recipe_version_id = v_version
       and ri.quantity * p_produced <> 0;
  end if;

  -- Un rendement inférieur au plan est une question ouverte, pas une fatalité.
  -- L'écart porte l'identifiant que le client lui a donné : c'est lui qui
  -- reviendra plus tard dans `resolve_variance`.
  if p_variance_id is not null and coalesce(p_loss, 0) > 0 then
    insert into public.variances (
      id, organization_id, site_id, source, reference_id, subject,
      theoretical, declared, delta, amount,
      actor_user_id, actor_user_name, actor_post, actor_capability, created_at
    ) values (
      p_variance_id, v_org, p_site_id, 'YIELD', v_batch_id,
      format('Batch %s', p_code),
      coalesce(p_planned, p_produced), p_produced,
      p_produced - coalesce(p_planned, p_produced), abs(coalesce(p_variance_amount, 0)),
      v_user, v_user_name, v_post, 'PRODUCE', v_at
    )
    on conflict (id) do nothing;
  end if;

  v_yield := case when coalesce(p_planned, 0) > 0
                  then round(p_produced / p_planned * 100) else 100 end;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'BATCH_COMPLETED', 'ProductionBatch', v_batch_id,
    v_user, p_device_id,
    jsonb_build_object('itemId', p_item_id, 'code', p_code, 'locationId', p_location_id,
                       'planned', p_planned, 'produced', p_produced, 'loss', p_loss,
                       'yieldPct', v_yield, 'consumption', p_consumption),
    v_at
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Batch %s', p_code),
    format('%s/%s unités · rendement %s %%', p_produced, coalesce(p_planned, p_produced), v_yield),
    format('batch:%s', p_code),
    p_device_id, 'PRODUCE', v_at
  );

  return v_batch_id;
end;
$$;

CREATE FUNCTION public.record_expense(p_event_id uuid, p_expense_id uuid, p_site_id uuid, p_amount numeric, p_category text, p_description text, p_supplier_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'CASH'::text, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_expense_id uuid; v_existing uuid; v_at timestamptz;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'EXPENSE_RECORDED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('RECORD_EXPENSE') then
    raise exception 'Vous n''avez pas l''autorisation d''enregistrer une dépense.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'RECORD_EXPENSE', true);

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Une dépense porte un montant positif';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Une dépense dit sur quoi elle porte';
  end if;

  v_at         := coalesce(p_created_at_local, now());
  v_expense_id := coalesce(p_expense_id, gen_random_uuid());

  insert into public.expenses (
    id, organization_id, site_id, amount, category, description,
    supplier_id, payment_method, user_id, created_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at, device_id
  ) values (
    v_expense_id, v_org, p_site_id, p_amount, p_category, p_description,
    p_supplier_id, coalesce(p_payment_method, 'CASH'), v_user, v_at,
    v_user, v_user_name, v_post, 'RECORD_EXPENSE', v_at, p_device_id
  );

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'EXPENSE_RECORDED', 'Expense', v_expense_id,
    v_user, p_device_id,
    jsonb_build_object('amount', p_amount, 'category', p_category,
                       'description', p_description, 'supplierId', p_supplier_id,
                       'paymentMethod', p_payment_method),
    v_at
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Dépense — %s', p_description),
    format('%s FCFA · %s', round(p_amount), p_category),
    format('expense:%s', left(v_expense_id::text, 8)),
    p_device_id, 'RECORD_EXPENSE', v_at
  );

  return v_expense_id;
end;
$$;

CREATE FUNCTION public.open_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_session_id uuid; v_existing uuid; v_at timestamptz;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'CASH_SESSION_OPENED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('MANAGE_CASH_SESSION') then
    raise exception 'Vous n''avez pas l''autorisation d''ouvrir la caisse.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'MANAGE_CASH_SESSION', true);

  v_at         := coalesce(p_created_at_local, now());
  v_session_id := coalesce(p_cash_session_id, gen_random_uuid());

  insert into public.cash_sessions (
    id, organization_id, site_id, seller_id, shift_number, opening_cash, opened_at
  ) values (
    v_session_id, v_org, p_site_id, v_user, coalesce(p_shift_number, 1),
    coalesce(p_opening_cash, 0), v_at
  )
  on conflict (id) do nothing;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'CASH_SESSION_OPENED', 'CashSession', v_session_id,
    v_user, p_device_id,
    jsonb_build_object('shiftNumber', p_shift_number, 'openingCash', p_opening_cash),
    v_at
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Ouverture shift #%s', coalesce(p_shift_number, 1)),
    format('fond de caisse %s FCFA', round(coalesce(p_opening_cash, 0))),
    format('shift:%s', coalesce(p_shift_number, 1)),
    p_device_id, 'MANAGE_CASH_SESSION', v_at
  );

  return v_session_id;
end;
$$;

CREATE FUNCTION public.close_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_expected numeric, p_counted_cash numeric, p_variance numeric, p_reason text DEFAULT NULL::text, p_variance_id uuid DEFAULT NULL::uuid, p_created_at_local timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_session_id uuid; v_existing uuid; v_at timestamptz; v_variance numeric;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'CASH_SESSION_CLOSED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('MANAGE_CASH_SESSION') then
    raise exception 'Vous n''avez pas l''autorisation de fermer la caisse.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'MANAGE_CASH_SESSION', true);

  v_at         := coalesce(p_created_at_local, now());
  v_variance   := coalesce(p_variance, coalesce(p_counted_cash, 0) - coalesce(p_expected, 0));
  v_session_id := coalesce(p_cash_session_id, gen_random_uuid());

  insert into public.cash_sessions (
    id, organization_id, site_id, seller_id, shift_number, opening_cash, opened_at
  ) values (
    v_session_id, v_org, p_site_id, v_user, coalesce(p_shift_number, 1),
    coalesce(p_opening_cash, 0), v_at
  )
  on conflict (id) do nothing;

  update public.cash_sessions
     set counted_cash    = p_counted_cash,
         variance_reason = nullif(trim(coalesce(p_reason, '')), ''),
         closed_at       = v_at
   where id = v_session_id
     and organization_id = v_org;

  if p_variance_id is not null and v_variance <> 0 then
    insert into public.variances (
      id, organization_id, site_id, source, reference_id, subject,
      theoretical, declared, delta, amount,
      actor_user_id, actor_user_name, actor_post, actor_capability, created_at
    ) values (
      p_variance_id, v_org, p_site_id, 'CASH', v_session_id,
      format('Shift #%s', coalesce(p_shift_number, 1)),
      coalesce(p_expected, 0), coalesce(p_counted_cash, 0), v_variance, abs(v_variance),
      v_user, v_user_name, v_post, 'MANAGE_CASH_SESSION', v_at
    )
    on conflict (id) do nothing;
  end if;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'CASH_SESSION_CLOSED', 'CashSession', v_session_id,
    v_user, p_device_id,
    jsonb_build_object('shiftNumber', p_shift_number, 'expected', p_expected,
                       'countedCash', p_counted_cash, 'variance', v_variance,
                       'reason', p_reason),
    v_at
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Clôture shift #%s — écart %s%s FCFA',
           coalesce(p_shift_number, 1),
           case when v_variance >= 0 then '+' else '' end, round(v_variance)),
    case when coalesce(trim(coalesce(p_reason, '')), '') = ''
         then 'sans écart' else format('motif : %s', p_reason) end,
    format('shift:%s', coalesce(p_shift_number, 1)),
    p_device_id, 'MANAGE_CASH_SESSION', v_at
  );

  return v_session_id;
end;
$$;

CREATE FUNCTION public.grant_capability(p_user_id uuid, p_capability text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_target_org uuid; v_target_name text; v_cap public.capability; v_id uuid;
begin
  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('MANAGE_TEAM') then
    raise exception 'Vous n''avez pas l''autorisation de gérer les accès de l''équipe.'
      using errcode = '42501';
  end if;

  v_cap := p_capability::public.capability;

  select organization_id, name into v_target_org, v_target_name
    from public.profiles where id = p_user_id;
  if v_target_org is null or v_target_org <> v_org then
    raise exception 'Cette personne ne fait pas partie de votre organisation';
  end if;

  -- Accord déjà actif : on rend le sien, on n'en ouvre pas un second —
  -- sinon retirer un droit demanderait deux révocations.
  select id into v_id from public.user_capabilities
   where user_id = p_user_id and capability = v_cap and revoked_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.user_capabilities (
    organization_id, user_id, capability, granted_by, granted_at
  ) values (
    v_org, p_user_id, v_cap, v_user, now()
  )
  returning id into v_id;

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference, capability
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Accès accordé — %s', coalesce(v_target_name, 'membre')),
    p_capability, format('team:%s', left(p_user_id::text, 8)), 'MANAGE_TEAM'
  );

  return v_id;
end;
$$;

CREATE FUNCTION public.revoke_capability(p_user_id uuid, p_capability text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_target_org uuid; v_target_name text; v_cap public.capability; v_touched int;
begin
  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('MANAGE_TEAM') then
    raise exception 'Vous n''avez pas l''autorisation de gérer les accès de l''équipe.'
      using errcode = '42501';
  end if;

  v_cap := p_capability::public.capability;

  -- Personne ne se retire à soi-même la gestion de l'équipe : l'organisation
  -- se retrouverait sans personne pour redonner le droit.
  if p_user_id = v_user and v_cap = 'MANAGE_TEAM' then
    raise exception 'Vous ne pouvez pas retirer votre propre gestion de l''équipe.';
  end if;

  select organization_id, name into v_target_org, v_target_name
    from public.profiles where id = p_user_id;
  if v_target_org is null or v_target_org <> v_org then
    raise exception 'Cette personne ne fait pas partie de votre organisation';
  end if;

  update public.user_capabilities
     set revoked_by = v_user, revoked_at = now()
   where user_id = p_user_id and capability = v_cap and revoked_at is null;
  get diagnostics v_touched = row_count;

  -- Rien à retirer : le droit n'était pas actif. Ce n'est pas une erreur,
  -- c'est le résultat déjà atteint.
  if v_touched = 0 then
    return;
  end if;

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference, capability
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Accès retiré — %s', coalesce(v_target_name, 'membre')),
    p_capability, format('team:%s', left(p_user_id::text, 8)), 'MANAGE_TEAM'
  );
end;
$$;


-- Privilèges : `execute` retiré à PUBLIC, accordé explicitement.

REVOKE ALL ON FUNCTION public.apply_inventory_count(p_event_id uuid, p_count_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_unit text, p_theoretical numeric, p_counted numeric, p_delta numeric, p_reason text, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_inventory_count(p_event_id uuid, p_count_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_unit text, p_theoretical numeric, p_counted numeric, p_delta numeric, p_reason text, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.apply_inventory_count(p_event_id uuid, p_count_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_unit text, p_theoretical numeric, p_counted numeric, p_delta numeric, p_reason text, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.apply_inventory_count(p_event_id uuid, p_count_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_unit text, p_theoretical numeric, p_counted numeric, p_delta numeric, p_reason text, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
REVOKE ALL ON FUNCTION public.close_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_expected numeric, p_counted_cash numeric, p_variance numeric, p_reason text, p_variance_id uuid, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_expected numeric, p_counted_cash numeric, p_variance numeric, p_reason text, p_variance_id uuid, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.close_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_expected numeric, p_counted_cash numeric, p_variance numeric, p_reason text, p_variance_id uuid, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.close_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_expected numeric, p_counted_cash numeric, p_variance numeric, p_reason text, p_variance_id uuid, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_batch(p_event_id uuid, p_batch_id uuid, p_site_id uuid, p_code text, p_item_id uuid, p_recipe_version_id uuid, p_location_id uuid, p_planned numeric, p_produced numeric, p_loss numeric, p_consumption jsonb, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_batch(p_event_id uuid, p_batch_id uuid, p_site_id uuid, p_code text, p_item_id uuid, p_recipe_version_id uuid, p_location_id uuid, p_planned numeric, p_produced numeric, p_loss numeric, p_consumption jsonb, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.complete_batch(p_event_id uuid, p_batch_id uuid, p_site_id uuid, p_code text, p_item_id uuid, p_recipe_version_id uuid, p_location_id uuid, p_planned numeric, p_produced numeric, p_loss numeric, p_consumption jsonb, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_batch(p_event_id uuid, p_batch_id uuid, p_site_id uuid, p_code text, p_item_id uuid, p_recipe_version_id uuid, p_location_id uuid, p_planned numeric, p_produced numeric, p_loss numeric, p_consumption jsonb, p_variance_id uuid, p_variance_amount numeric, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
REVOKE ALL ON FUNCTION public.grant_capability(p_user_id uuid, p_capability text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.grant_capability(p_user_id uuid, p_capability text) TO anon;
GRANT ALL ON FUNCTION public.grant_capability(p_user_id uuid, p_capability text) TO authenticated;
GRANT ALL ON FUNCTION public.grant_capability(p_user_id uuid, p_capability text) TO service_role;
REVOKE ALL ON FUNCTION public.open_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.open_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.open_cash_session(p_event_id uuid, p_cash_session_id uuid, p_site_id uuid, p_shift_number integer, p_opening_cash numeric, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
REVOKE ALL ON FUNCTION public.record_expense(p_event_id uuid, p_expense_id uuid, p_site_id uuid, p_amount numeric, p_category text, p_description text, p_supplier_id uuid, p_payment_method text, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_expense(p_event_id uuid, p_expense_id uuid, p_site_id uuid, p_amount numeric, p_category text, p_description text, p_supplier_id uuid, p_payment_method text, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.record_expense(p_event_id uuid, p_expense_id uuid, p_site_id uuid, p_amount numeric, p_category text, p_description text, p_supplier_id uuid, p_payment_method text, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.record_expense(p_event_id uuid, p_expense_id uuid, p_site_id uuid, p_amount numeric, p_category text, p_description text, p_supplier_id uuid, p_payment_method text, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
REVOKE ALL ON FUNCTION public.record_waste(p_event_id uuid, p_waste_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_quantity numeric, p_unit text, p_cost numeric, p_reason text, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_waste(p_event_id uuid, p_waste_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_quantity numeric, p_unit text, p_cost numeric, p_reason text, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.record_waste(p_event_id uuid, p_waste_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_quantity numeric, p_unit text, p_cost numeric, p_reason text, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.record_waste(p_event_id uuid, p_waste_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_quantity numeric, p_unit text, p_cost numeric, p_reason text, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
REVOKE ALL ON FUNCTION public.revoke_capability(p_user_id uuid, p_capability text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_capability(p_user_id uuid, p_capability text) TO anon;
GRANT ALL ON FUNCTION public.revoke_capability(p_user_id uuid, p_capability text) TO authenticated;
GRANT ALL ON FUNCTION public.revoke_capability(p_user_id uuid, p_capability text) TO service_role;
REVOKE ALL ON FUNCTION public.transfer_stock(p_event_id uuid, p_transfer_id uuid, p_site_id uuid, p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_unit text, p_created_at_local timestamp with time zone, p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_stock(p_event_id uuid, p_transfer_id uuid, p_site_id uuid, p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_unit text, p_created_at_local timestamp with time zone, p_device_id text) TO anon;
GRANT ALL ON FUNCTION public.transfer_stock(p_event_id uuid, p_transfer_id uuid, p_site_id uuid, p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_unit text, p_created_at_local timestamp with time zone, p_device_id text) TO authenticated;
GRANT ALL ON FUNCTION public.transfer_stock(p_event_id uuid, p_transfer_id uuid, p_site_id uuid, p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_unit text, p_created_at_local timestamp with time zone, p_device_id text) TO service_role;
