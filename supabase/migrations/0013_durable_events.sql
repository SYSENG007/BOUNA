-- =====================================================================
-- BUNA Operations — 0013 : les douze faits qui n'arrivaient nulle part
--
-- `RPC_BY_EVENT` ne connaissait que trois transactions : la vente, son
-- annulation, la réception. Les douze autres événements partaient dans
-- `domain_events` comme une ligne JSON inerte — et le transport les
-- comptait comme acceptés. Vérifié en base : AUCUN déclencheur ne rejoue
-- `domain_events`. Une perte déclarée n'existait donc nulle part ailleurs
-- que sur le téléphone qui l'avait saisie, et la première hydratation la
-- faisait disparaître : `HYDRATE_SNAPSHOT` remplace les mouvements par la
-- version serveur. Le stock remontait tout seul, après un « synchronisé ».
--
-- Ce fichier écrit les transactions manquantes. Chacune suit le patron de
-- `complete_sale` :
--
--   1. contrôle d'idempotence sur `p_event_id` — un retry réseau retrouve
--      l'entité déjà produite au lieu d'en fabriquer une seconde ;
--   2. garde de capacité, avec un message qui parle à la personne ;
--   3. pose de `buna.capability` : c'est ce que le déclencheur d'estampille
--      de 0012 lira pour dire SOUS QUELLE autorisation le fait a eu lieu ;
--   4. écriture du fait, de ses mouvements de stock, de la ligne
--      `domain_events` et de la ligne de journal — dans LA MÊME transaction.
--
-- RULE-002 / RULE-003 : aucune de ces fonctions n'écrit un niveau de stock.
-- Un stock se déduit de `stock_movements`, toujours.
--
-- Les unités et les énumérations arrivent en `text` puis sont converties
-- ici. PostgREST résout la fonction par le nom de ses arguments : un
-- paramètre typé enum l'oblige à deviner un cast, un paramètre `text` ne
-- laisse aucune place au doute — et un code invalide échoue franchement
-- (22P02), ce que le transport sait lire comme un refus définitif.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. LA PERTE
--
-- Déclarer une perte, c'est deux faits : l'événement de perte, qui porte
-- le motif et le coût, et le mouvement négatif qui l'inscrit au stock.
-- Séparés, ils divergent ; ensemble, ils tiennent.
-- ---------------------------------------------------------------------

create or replace function public.record_waste(
  p_event_id         uuid,
  p_waste_id         uuid,
  p_site_id          uuid,
  p_location_id      uuid,
  p_item_id          uuid,
  p_quantity         numeric,
  p_unit             text,
  p_cost             numeric,
  p_reason           text,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 2. LE TRANSFERT
--
-- §30 — deux mouvements qui partagent la même référence. Aucune table de
-- transfert : le transfert EST la paire de mouvements. En écrire un seul
-- ferait apparaître ou disparaître de la marchandise.
-- ---------------------------------------------------------------------

create or replace function public.transfer_stock(
  p_event_id          uuid,
  p_transfer_id       uuid,
  p_site_id           uuid,
  p_item_id           uuid,
  p_from_location_id  uuid,
  p_to_location_id    uuid,
  p_quantity          numeric,
  p_unit              text,
  p_created_at_local  timestamptz default null,
  p_device_id         text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 3. LA PRÉPARATION
--
-- La consommation arrive du client, comme les lignes d'une réception : il
-- a déjà décidé d'OÙ sort chaque ingrédient (le lait est au frigo, pas à
-- la cuisine). La recalculer ici sur l'emplacement de sortie ferait
-- plonger un emplacement en négatif pendant qu'un autre reste plein.
-- Faute de lignes, on retombe sur la recette — mieux qu'aucune consommation.
-- ---------------------------------------------------------------------

create or replace function public.complete_batch(
  p_event_id         uuid,
  p_batch_id         uuid,
  p_site_id          uuid,
  p_code             text,
  p_item_id          uuid,
  p_recipe_version_id uuid,
  p_location_id      uuid,
  p_planned          numeric,
  p_produced         numeric,
  p_loss             numeric,
  p_consumption      jsonb default '[]'::jsonb,  -- [{item_id, location_id, quantity, unit}]
  p_variance_id      uuid default null,
  p_variance_amount  numeric default 0,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 4. LE COMPTAGE
--
-- Compter ne corrige pas le stock : ça constate un écart et l'inscrit
-- comme un mouvement d'ajustement motivé (RULE-003 / RULE-008). Le stock
-- reste la somme des mouvements, y compris celui-là.
-- ---------------------------------------------------------------------

create or replace function public.apply_inventory_count(
  p_event_id         uuid,
  p_count_id         uuid,
  p_site_id          uuid,
  p_location_id      uuid,
  p_item_id          uuid,
  p_unit             text,
  p_theoretical      numeric,
  p_counted          numeric,
  p_delta            numeric,
  p_reason           text,
  p_variance_id      uuid default null,
  p_variance_amount  numeric default 0,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 5. LA DÉPENSE
-- ---------------------------------------------------------------------

create or replace function public.record_expense(
  p_event_id         uuid,
  p_expense_id       uuid,
  p_site_id          uuid,
  p_amount           numeric,
  p_category         text,
  p_description      text,
  p_supplier_id      uuid default null,
  p_payment_method   text default 'CASH',
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 6. LA CAISSE
--
-- `cash_sessions` ne porte pas de colonnes `actor_*` : la traçabilité de
-- la caisse passe par `seller_id`, le journal et `domain_events`.
--
-- La clôture crée la session si elle n'existe pas encore : un poste peut
-- avoir ouvert sa caisse hors ligne, ou avoir démarré sur un état de
-- démonstration. Refuser la clôture perdrait le comptage réel — le seul
-- chiffre que personne ne peut recalculer après coup.
-- ---------------------------------------------------------------------

create or replace function public.open_cash_session(
  p_event_id         uuid,
  p_cash_session_id  uuid,
  p_site_id          uuid,
  p_shift_number     integer,
  p_opening_cash     numeric,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.close_cash_session(
  p_event_id         uuid,
  p_cash_session_id  uuid,
  p_site_id          uuid,
  p_shift_number     integer,
  p_opening_cash     numeric,
  p_expected         numeric,
  p_counted_cash     numeric,
  p_variance         numeric,
  p_reason           text default null,
  p_variance_id      uuid default null,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 7. LE RECOUVREMENT D'UN ÉCART
--
-- L'écart est né côté client — d'un comptage, d'une clôture, d'un
-- rendement — et il porte déjà son identifiant. S'il n'est pas encore
-- arrivé en base (son événement d'origine a été refusé, ou la ligne s'est
-- perdue), on le recrée depuis la charge utile : un écart soldé sans
-- écart enregistré serait un motif sans question.
-- ---------------------------------------------------------------------

create or replace function public.resolve_variance(
  p_event_id         uuid,
  p_variance_id      uuid,
  p_site_id          uuid,
  p_source           text,
  p_reference_id     uuid,
  p_subject          text,
  p_theoretical      numeric,
  p_declared         numeric,
  p_delta            numeric,
  p_amount           numeric,
  p_resolution       text,
  p_note             text default null,
  p_detected_at      timestamptz default null,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_existing uuid; v_at timestamptz; v_variance public.variances%rowtype;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'STOCK_VARIANCE_DETECTED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('RESOLVE_VARIANCE') then
    raise exception 'Vous n''avez pas l''autorisation de solder un écart.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'RESOLVE_VARIANCE', true);

  if coalesce(trim(p_resolution), '') = '' then
    raise exception 'RULE-008 : on ne solde pas un écart sans motif';
  end if;

  v_at := coalesce(p_created_at_local, now());

  insert into public.variances (
    id, organization_id, site_id, source, reference_id, subject,
    theoretical, declared, delta, amount,
    actor_user_id, actor_user_name, actor_post, actor_capability, created_at
  ) values (
    p_variance_id, v_org, p_site_id, coalesce(p_source, 'STOCK')::public.variance_source,
    coalesce(p_reference_id, p_variance_id), coalesce(p_subject, 'Écart'),
    coalesce(p_theoretical, 0), coalesce(p_declared, 0), coalesce(p_delta, 0),
    abs(coalesce(p_amount, 0)),
    v_user, v_user_name, v_post, 'RESOLVE_VARIANCE',
    coalesce(p_detected_at, v_at)
  )
  on conflict (id) do nothing;

  select * into v_variance from public.variances
   where id = p_variance_id and organization_id = v_org;
  if v_variance.id is null then
    raise exception 'Écart introuvable';
  end if;

  -- Le premier motif fait foi : un écart soldé ne se resolde pas.
  if v_variance.resolution is null then
    update public.variances
       set resolution         = p_resolution::public.variance_resolution,
           resolution_note    = nullif(trim(coalesce(p_note, '')), ''),
           resolver_user_id   = v_user,
           resolver_user_name = v_user_name,
           resolved_at        = v_at
     where id = p_variance_id;
  end if;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'STOCK_VARIANCE_DETECTED', 'Variance', p_variance_id,
    v_user, p_device_id,
    jsonb_build_object('source', p_source, 'delta', p_delta, 'amount', p_amount,
                       'resolution', p_resolution, 'note', p_note),
    v_at
  );

  insert into public.audit_events (
    organization_id, user_id, user_name, post, action, detail, reference,
    device_id, capability, created_at
  ) values (
    v_org, v_user, v_user_name, v_post,
    format('Écart soldé — %s', v_variance.subject),
    format('%s FCFA · %s%s', round(v_variance.amount), p_resolution,
           case when coalesce(trim(coalesce(p_note, '')), '') = ''
                then '' else format(' · %s', p_note) end),
    format('variance:%s', left(p_variance_id::text, 8)),
    p_device_id, 'RESOLVE_VARIANCE', v_at
  );

  return p_variance_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. L'ENCAISSEMENT
--
-- Il n'existe pas de table des paiements : le moyen et le montant vivent
-- sur la vente. Cette fonction ne duplique donc rien — elle vérifie que
-- l'encaissement correspond bien à une vente enregistrée, et journalise
-- le fait de manière idempotente.
--
-- Vente pas encore arrivée : l'erreur est volontairement RÉESSAYABLE
-- (classe 40, « recommencez »). Un refus définitif ferait sortir
-- l'encaissement de la file pendant que sa vente, elle, serait renvoyée
-- avec succès — la caisse afficherait alors une vente sans encaissement.
-- ---------------------------------------------------------------------

create or replace function public.record_payment(
  p_event_id         uuid,
  p_sale_id          uuid,
  p_site_id          uuid,
  p_payment_method   text,
  p_amount           numeric,
  p_created_at_local timestamptz default null,
  p_device_id        text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_post public.user_post; v_user_name text;
  v_existing uuid; v_at timestamptz; v_sale public.sales%rowtype;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'PAYMENT_RECEIVED';
  if v_existing is not null then
    return v_existing;
  end if;

  select organization_id, post, name into v_org, v_post, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

  if not public.has_capability('SELL') then
    raise exception 'Vous n''avez pas l''autorisation d''encaisser une vente.'
      using errcode = '42501';
  end if;

  perform set_config('buna.capability', 'SELL', true);

  select * into v_sale from public.sales where id = p_sale_id and organization_id = v_org;
  if v_sale.id is null then
    raise exception 'La vente de cet encaissement n''est pas encore enregistrée.'
      using errcode = '40001';
  end if;

  v_at := coalesce(p_created_at_local, now());

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, coalesce(p_site_id, v_sale.site_id), 'PAYMENT_RECEIVED', 'Sale',
    p_sale_id, v_user, p_device_id,
    jsonb_build_object('paymentMethod', p_payment_method, 'amount', p_amount),
    v_at
  );

  return p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. LA DÉLÉGATION
--
-- Jusqu'ici, accorder un accès ne touchait que le réducteur local : le
-- droit disparaissait au rechargement, puisque le profil relit ses
-- capacités depuis `user_capabilities`. Ces deux fonctions écrivent le
-- fait en base.
--
-- Aucune ne prend de `p_event_id` : la délégation n'a pas de type
-- d'événement, elle ne passe donc pas par la file. L'idempotence tient
-- ici à la donnée elle-même — l'index unique partiel interdit deux
-- accords actifs identiques, et révoquer ce qui est déjà révoqué ne
-- touche aucune ligne.
--
-- Révoquer ne supprime pas : ça date la fin. Sinon « qui avait le droit
-- le 12 août ? » redevient insoluble.
-- ---------------------------------------------------------------------

create or replace function public.grant_capability(
  p_user_id    uuid,
  p_capability text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.revoke_capability(
  p_user_id    uuid,
  p_capability text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------
-- 10. PRIVILÈGES
--
-- Postgres accorde EXECUTE à PUBLIC par défaut : un `revoke ... from anon`
-- seul ne fait rien. On révoque de `public`, puis on accorde nommément.
-- Les signatures sont lues dans le catalogue — une signature devinée
-- produit un revoke qui échoue, ou pire, qui porte à côté et laisse la
-- vraie fonction ouverte.
-- ---------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_waste','transfer_stock','complete_batch','apply_inventory_count',
        'record_expense','open_cash_session','close_cash_session','resolve_variance',
        'record_payment','grant_capability','revoke_capability'
      )
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
