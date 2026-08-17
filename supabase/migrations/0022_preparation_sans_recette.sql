-- 0022 — Déclarer une préparation sans recette.
--
-- Le blocage rapporté par le terrain est une impasse circulaire : pas de
-- recette, pas de production ; pas de production, pas de produit fini ; pas de
-- produit fini, pas de vente. Un établissement qui ouvre n'a pas encore de
-- recettes exactes — l'application lui demandait donc d'en inventer pour avoir
-- le droit de travailler.
--
-- Le verrou n'était pas seulement à l'écran. `complete_batch` levait
-- « Aucune recette enregistrée pour « X » », et `recipe_version_id` est
-- `not null`. Débloquer le client seul aurait produit des événements que la
-- file réessaie indéfiniment : l'application dirait oui, la base dirait non,
-- et personne ne le verrait avant la synchronisation. Le déblocage doit être
-- complet ou ne pas être.
--
-- Ce que cette migration NE change pas : le stock reste une projection des
-- mouvements, l'idempotence tient toujours à `p_event_id`, la garde
-- `has_capability('PRODUCE')` reste en place, et une quantité produite nulle
-- ou négative reste refusée.
--
-- Ce qu'elle assume : le serveur cesse d'être le gardien de la précision. Un
-- lot peut désormais dire ce qu'il a produit sans prétendre dire ce qu'il a
-- consommé. C'est au régime d'exploitation, côté client, d'exiger la recette
-- quand l'établissement a choisi de la tenir. RLS continue de protéger les
-- données ; il ne protège plus la méthode.

-- ------------------------------------------------------------------ Colonne

-- Un lot sans recette est un état légitime, pas une donnée manquante.
alter table public.production_batches
  alter column recipe_version_id drop not null;

comment on column public.production_batches.recipe_version_id is
  'La recette figée qui a servi, quand il y en avait une. NULL : préparation '
  'déclarée sans recette — le lot dit ce qu''il a produit, pas ce qu''il a '
  'consommé. La consommation vient alors de ce que le préparateur a constaté, '
  'ou de rien du tout, et c''est le comptage de fin de journée qui la rattrape.';

-- ---------------------------------------------------------------- Fonction

-- `create or replace` conserve la signature, donc les privilèges déjà posés
-- par 0017. Le bloc de privilèges est réaffirmé en fin de fichier malgré tout :
-- une fonction qui écrit du stock ne doit jamais dépendre d'un `revoke` posé
-- ailleurs pour ne pas être appelable anonymement.
create or replace function public.complete_batch(
  p_event_id uuid, p_batch_id uuid, p_site_id uuid, p_code text, p_item_id uuid,
  p_recipe_version_id uuid, p_location_id uuid, p_planned numeric, p_produced numeric,
  p_loss numeric, p_consumption jsonb default '[]'::jsonb, p_variance_id uuid default null::uuid,
  p_variance_amount numeric default 0,
  p_created_at_local timestamp with time zone default null::timestamp with time zone,
  p_device_id text default null::text
) returns uuid
    language plpgsql security definer
    set search_path to ''
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

  -- La recette demandée, sinon celle en cours pour ce produit, sinon aucune.
  -- L'absence ne lève plus : elle se conserve telle quelle.
  v_version := coalesce(p_recipe_version_id, public.current_recipe_version(p_item_id));

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

  -- Ce qui sort de la préparation. C'est le seul mouvement certain : quelqu'un
  -- a réellement posé ces unités sur une étagère.
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

  -- Ce qu'elle a consommé — le constat d'abord, la recette ensuite.
  --
  -- Les deux quantités ne sont pas du même ordre : ce que le préparateur
  -- constate est un TOTAL pour le lot, là où une recette dose UNE unité et se
  -- multiplie. Le client applique exactement la même règle (`consumedBy`) ;
  -- elle doit rester identique des deux côtés, sinon les deux projections
  -- divergent sur le même fait.
  if jsonb_array_length(coalesce(p_consumption, '[]'::jsonb)) > 0 then
    insert into public.stock_movements (
      organization_id, site_id, location_id, item_id, quantity, unit,
      movement_type, reference_type, reference_id, user_id, device_id, created_at,
      actor_user_id, actor_user_name, actor_post, actor_capability, actor_at
    )
    -- `location_id` de la ligne quand le client l'a envoyé, sinon celui du
    -- lot. La colonne est NOT NULL : les événements déjà en file, écrits par
    -- un client qui ne l'envoyait pas, échouaient ici sur un `23502` et se
    -- réessayaient sans fin. Le repli les fait enfin passer.
    select v_org, p_site_id,
           coalesce((line->>'location_id')::uuid, p_location_id), (line->>'item_id')::uuid,
           -(line->>'quantity')::numeric, (line->>'unit')::public.unit_code,
           'PRODUCTION_CONSUMPTION', 'ProductionBatch', v_batch_id, v_user, p_device_id, v_at,
           v_user, v_user_name, v_post, 'PRODUCE', v_at
      from jsonb_array_elements(p_consumption) as line
     where coalesce((line->>'quantity')::numeric, 0) <> 0;

  elsif v_version is not null then
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

  -- Sinon : ni constat ni recette. Le lot ajoute du stock sans en déduire.
  -- C'est incomplet, ce n'est pas faux — et inventer une consommation serait
  -- pire que de n'en écrire aucune.
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
                       'recipeVersionId', v_version,
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

-- ------------------------------------------------------------- Privilèges

-- Postgres accorde `EXECUTE` à PUBLIC par défaut, et Supabase y ajoute `anon` :
-- un `revoke ... from anon` seul ne suffirait pas, il faut retirer PUBLIC.
revoke execute on function public.complete_batch(
  uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, numeric, jsonb,
  uuid, numeric, timestamptz, text
) from public, anon;

grant execute on function public.complete_batch(
  uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, numeric, jsonb,
  uuid, numeric, timestamptz, text
) to authenticated;
