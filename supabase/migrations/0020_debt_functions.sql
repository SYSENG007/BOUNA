-- 0020 — `record_expense` porte une dette optionnelle.
--
-- Suite de 0019 : les valeurs d'enum sont posées, cette migration câble le
-- comportement qui les utilise côté dépense.
--
-- Le `DROP FUNCTION` explicite qui suit n'est pas cosmétique : insérer des
-- paramètres dans la liste change sa signature de type, et `CREATE OR REPLACE`
-- ne remplace une fonction que si cette signature est identique. Sans le
-- DROP, Postgres aurait gardé les deux versions — l'ancienne à dix arguments
-- et la nouvelle — et PostgREST aurait pu choisir l'une ou l'autre selon
-- l'appel, silencieusement. Vérifié avant d'écrire cette migration : un essai
-- dans une transaction annulée l'a confirmé.
--
-- La résolution d'un écart (caisse, stock, rendement, et maintenant dette) a
-- déjà sa fonction serveur, `resolve_variance` — posée par un travail
-- antérieur non capturé dans ce dépôt de migrations, et retrouvée seulement
-- en interrogeant la base (voir 0021, qui la documente et l'y inscrit). Un
-- premier réflexe ici avait été d'en écrire une nouvelle, plus étroite ; elle
-- aurait cohabité avec celle-ci en double surcharge, silencieusement choisie
-- par PostgREST selon l'appel. Elle a été retirée avant d'atteindre ce
-- fichier. La leçon : une fonction absente du dépôt n'est pas une fonction
-- absente de la base.

drop function if exists public.record_expense(uuid, uuid, uuid, numeric, text, text, uuid, text, timestamptz, text);

create function public.record_expense(
  p_event_id uuid, p_expense_id uuid, p_site_id uuid, p_amount numeric,
  p_category text, p_description text, p_supplier_id uuid default null::uuid,
  p_payment_method text default 'CASH'::text,
  p_created_at_local timestamp with time zone default null::timestamp with time zone,
  p_device_id text default null::text,
  p_variance_id uuid default null::uuid, p_variance_amount numeric default 0,
  p_variance_subject text default null::text
) returns uuid
    language plpgsql security definer
    set search_path to ''
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
    raise exception 'Une dépense porte sur un montant positif';
  end if;

  v_at         := coalesce(p_created_at_local, now());
  v_expense_id := coalesce(p_expense_id, gen_random_uuid());

  insert into public.expenses (
    id, organization_id, site_id, amount, category, description, supplier_id,
    payment_method, user_id, created_at,
    actor_user_id, actor_user_name, actor_post, actor_capability, actor_at, device_id
  ) values (
    v_expense_id, v_org, p_site_id, p_amount, p_category, p_description, p_supplier_id,
    coalesce(p_payment_method, 'CASH'), v_user, v_at,
    v_user, v_user_name, v_post, 'RECORD_EXPENSE', v_at, p_device_id
  );

  -- L'emprunt qui a couvert le manque au tiroir : un écart ouvert, pas une
  -- ligne de plus dans les dépenses — sinon il double la dépense au lieu de
  -- suivre la dette qu'elle a créée.
  if p_variance_id is not null and coalesce(p_variance_amount, 0) > 0 then
    insert into public.variances (
      id, organization_id, site_id, source, reference_id, subject,
      theoretical, declared, delta, amount,
      actor_user_id, actor_user_name, actor_post, actor_capability, created_at
    ) values (
      p_variance_id, v_org, p_site_id, 'DEBT', v_expense_id,
      coalesce(p_variance_subject, 'Emprunt'),
      0, p_variance_amount, p_variance_amount, p_variance_amount,
      v_user, v_user_name, v_post, 'RECORD_EXPENSE', v_at
    )
    on conflict (id) do nothing;
  end if;

  insert into public.domain_events (
    id, organization_id, site_id, event_type, entity_type, entity_id,
    actor_user_id, device_id, payload, created_at_local
  ) values (
    p_event_id, v_org, p_site_id, 'EXPENSE_RECORDED', 'Expense', v_expense_id,
    v_user, p_device_id,
    jsonb_build_object('amount', p_amount, 'category', p_category, 'description', p_description,
                       'supplierId', p_supplier_id, 'paymentMethod', p_payment_method,
                       'varianceId', p_variance_id, 'varianceAmount', p_variance_amount),
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

revoke execute on function public.record_expense(uuid, uuid, uuid, numeric, text, text, uuid, text, timestamptz, text, uuid, numeric, text) from public, anon;
grant execute on function public.record_expense(uuid, uuid, uuid, numeric, text, text, uuid, text, timestamptz, text, uuid, numeric, text) to authenticated;
