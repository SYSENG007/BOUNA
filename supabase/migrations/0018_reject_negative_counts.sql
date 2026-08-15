-- 0018 — Un comptage ne peut pas être négatif.
--
-- `Waste`, `Transfer` et `Production` restent volontairement permissifs côté
-- serveur : chacun déclare un fait qui peut légitimement dépasser ce que le
-- système croit avoir en stock (perte réelle non encore constatée, décalage
-- entre appareils hors ligne). Un COMPTAGE est différent : ce n'est pas un
-- delta, c'est une quantité physique absolue, et aucune quantité physique
-- n'est négative. Un « -1 » qui franchit malgré tout jusqu'ici (bug client,
-- ancienne version de l'app, appel direct à l'API) fixerait le stock à cette
-- valeur impossible — plus direct et plus silencieux qu'une perte mal
-- dimensionnée, puisqu'il n'y a ici aucun « disponible » auquel se comparer.
--
-- Le client (`InventoryCount.tsx`) bloque déjà la saisie ; ceci est la
-- ceinture derrière la bretelle, pour que la garantie tienne même si un
-- appareil non mis à jour ou un appel API direct contourne l'écran.

create or replace function public.apply_inventory_count(p_event_id uuid, p_count_id uuid, p_site_id uuid, p_location_id uuid, p_item_id uuid, p_unit text, p_theoretical numeric, p_counted numeric, p_delta numeric, p_reason text, p_variance_id uuid default null::uuid, p_variance_amount numeric default 0, p_created_at_local timestamp with time zone default null::timestamp with time zone, p_device_id text default null::text) returns uuid
    language plpgsql security definer
    set search_path to ''
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

  -- Nouveau : aucune quantité physique comptée ne peut être négative.
  if coalesce(p_counted, 0) < 0 then
    raise exception 'Un comptage ne peut pas être négatif' using errcode = '22003';
  end if;

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

revoke execute on function public.apply_inventory_count(uuid, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, text, uuid, numeric, timestamptz, text) from public, anon;
grant execute on function public.apply_inventory_count(uuid, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, text, uuid, numeric, timestamptz, text) to authenticated;
