-- 0021 — `resolve_variance`, rattrapée dans le dépôt.
--
-- Cette fonction est déjà en production. Elle a été écrite pendant un
-- travail antérieur qui n'est passé par aucun fichier de ce dossier — le même
-- symptôme que 0008 en son temps : la base sait des choses que le dépôt
-- ignore. Elle n'a été découverte qu'en interrogeant `pg_proc` au moment
-- d'ajouter la prise en charge des dettes, après qu'une première tentative
-- d'en écrire une nouvelle, plus étroite, ait failli laisser deux fonctions
-- `resolve_variance` cohabiter en base (voir 0020).
--
-- Cette migration ne CHANGE rien : elle transcrit fidèlement ce qui tourne
-- déjà, pour que `supabase/migrations/` redonne enfin la base réelle si on la
-- rejoue depuis zéro.
--
-- Conçue en une seule fonction auto-suffisante : contrairement à
-- `apply_inventory_count`/`complete_batch`/`close_cash_session`, qui insèrent
-- l'écart au moment de sa DÉTECTION (pour qu'il soit visible sur d'autres
-- appareils avant même d'être soldé), celle-ci peut aussi bien insérer
-- l'écart à la RÉSOLUTION s'il n'existait pas encore côté serveur
-- (`on conflict (id) do nothing`) — un filet pour le cas où la détection
-- n'aurait jamais atteint le serveur.

create or replace function public.resolve_variance(
  p_event_id uuid, p_variance_id uuid, p_site_id uuid, p_source text,
  p_reference_id uuid, p_subject text, p_theoretical numeric, p_declared numeric,
  p_delta numeric, p_amount numeric, p_resolution text, p_note text default null::text,
  p_detected_at timestamp with time zone default null::timestamp with time zone,
  p_created_at_local timestamp with time zone default null::timestamp with time zone,
  p_device_id text default null::text
) returns uuid
    language plpgsql security definer
    set search_path to ''
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

revoke execute on function public.resolve_variance(uuid, uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, text, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.resolve_variance(uuid, uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, text, text, timestamptz, timestamptz, text) to authenticated;
