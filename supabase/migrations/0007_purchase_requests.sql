-- =====================================================================
-- BUNA Operations — demande d'achat, approbation, comparaison fournisseurs
-- Sprint 2 (§20)
--
-- `purchase_orders` portait déjà les statuts DRAFT → PENDING_APPROVAL →
-- APPROVED et les colonnes requested_by / approved_by. La demande d'achat
-- n'est donc pas une table de plus : c'est ce cycle de vie, mené jusqu'au
-- bout — refus motivé compris — et défendu par un trigger plutôt que par
-- l'écran qui l'affiche.
-- =====================================================================

-- Un refus n'est pas une annulation : il porte un motif et se relit.
alter type public.purchase_order_status add value if not exists 'REJECTED';

-- ------------------------------------------------------ Cycle de vie

alter table public.purchase_orders
  add column if not exists requested_at         timestamptz not null default now(),
  add column if not exists needed_by            date,
  add column if not exists priority             text not null default 'NORMALE',
  add column if not exists justification        text,
  add column if not exists approved_at          timestamptz,
  add column if not exists rejected_by          uuid references public.profiles(id),
  add column if not exists rejected_at          timestamptz,
  add column if not exists rejection_reason     text,
  add column if not exists ordered_at           timestamptz,
  -- Date promise par le fournisseur. Le retard se mesure contre elle, pas
  -- contre une moyenne théorique.
  add column if not exists expected_delivery_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_priority_check') then
    alter table public.purchase_orders
      add constraint purchase_orders_priority_check check (priority in ('NORMALE','URGENTE'));
  end if;
end $$;

create index if not exists idx_purchase_orders_org_status
  on public.purchase_orders (organization_id, status, requested_at desc);

create index if not exists idx_purchase_orders_rejected_by
  on public.purchase_orders (rejected_by);

-- Le fournisseur annonce un délai ; la base mesure celui qu'il tient.
alter table public.suppliers
  add column if not exists lead_time_days int,
  add column if not exists payment_terms  text,
  add column if not exists active         boolean not null default true;

-- ---------------------------------------------------------------------
-- Machine à états — défendue en base
--
-- Un appareil hors ligne peut resynchroniser une approbation après un
-- refus. Sans garde côté base, le dernier arrivé gagne et une demande
-- refusée repasse approuvée sans que personne ne l'ait rouverte.
-- ---------------------------------------------------------------------
create or replace function public.enforce_purchase_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := case old.status::text
    when 'DRAFT'              then array['PENDING_APPROVAL','CANCELLED']
    when 'PENDING_APPROVAL'   then array['APPROVED','REJECTED','DRAFT','CANCELLED']
    when 'APPROVED'           then array['PURCHASING','CANCELLED']
    when 'PURCHASING'         then array['PARTIALLY_RECEIVED','RECEIVED','CANCELLED']
    when 'PARTIALLY_RECEIVED' then array['RECEIVED','CLOSED']
    when 'RECEIVED'           then array['CLOSED']
    when 'REJECTED'           then array['DRAFT']       -- corrigée puis resoumise
    when 'CLOSED'             then array[]::text[]
    when 'CANCELLED'          then array[]::text[]
  end;

  if not (new.status::text = any(v_allowed)) then
    raise exception
      'Passage impossible de % à % pour la demande %',
      old.status, new.status, old.po_number
      using hint = 'Reprenez la demande depuis son état actuel.';
  end if;

  -- RULE-008 : un refus sans motif ne dit rien à celui qui a demandé.
  if new.status::text = 'REJECTED' and coalesce(trim(new.rejection_reason), '') = '' then
    raise exception 'Un refus doit dire pourquoi';
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_order_transition on public.purchase_orders;
create trigger purchase_order_transition
  before update of status on public.purchase_orders
  for each row execute function public.enforce_purchase_order_transition();

-- ---------------------------------------------------------------------
-- request_purchase — « il me manque ça »
--
-- N'importe quel rôle peut demander : c'est le préparateur qui voit le
-- bidon de lait se vider. L'arbitrage vient après, à l'approbation.
-- ---------------------------------------------------------------------
create or replace function public.request_purchase(
  p_event_id      uuid,
  p_site_id       uuid,
  p_supplier_id   uuid,
  p_lines         jsonb,   -- [{item_id, quantity, unit, expected_unit_price}]
  p_needed_by     date default null,
  p_priority      text default 'NORMALE',
  p_justification text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role public.user_role; v_user_name text;
  v_po_id uuid; v_existing uuid; v_number text; v_line jsonb; v_seq int;
begin
  select entity_id into v_existing from public.domain_events
    where id = p_event_id and event_type = 'PURCHASE_REQUESTED';
  if v_existing is not null then
    return v_existing;                       -- §56 : retry réseau, pas doublon
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'Utilisateur sans organisation';
  end if;

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
    organization_id, user_id, user_name, role, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_role,
    format('Demande d''achat %s', v_number),
    format('%s article(s) · %s', jsonb_array_length(p_lines), coalesce(p_priority,'NORMALE')),
    format('purchase_request:%s', v_number)
  );

  return v_po_id;
end;
$$;

-- ---------------------------------------------------------------------
-- approve_purchase_request / reject_purchase_request
-- ---------------------------------------------------------------------
create or replace function public.approve_purchase_request(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role public.user_role; v_user_name text;
  v_po public.purchase_orders%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;

  if v_role not in ('OWNER','MANAGER') then
    raise exception 'Rôle % non autorisé à approuver une demande', v_role;
  end if;

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
    organization_id, user_id, user_name, role, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_role,
    format('Approbation demande %s', v_po.po_number), p_comment,
    format('purchase_request:%s', v_po.po_number)
  );
end;
$$;

create or replace function public.reject_purchase_request(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role public.user_role; v_user_name text;
  v_po public.purchase_orders%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'RULE-008 : un refus doit dire pourquoi';
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;

  if v_role not in ('OWNER','MANAGER') then
    raise exception 'Rôle % non autorisé à refuser une demande', v_role;
  end if;

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
    organization_id, user_id, user_name, role, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_role,
    format('Refus demande %s', v_po.po_number),
    format('motif : %s', p_reason),
    format('purchase_request:%s', v_po.po_number)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- place_purchase_order — la demande approuvée part chez le fournisseur.
-- C'est ici qu'on note la date promise : sans elle, aucun retard n'est
-- mesurable ensuite.
-- ---------------------------------------------------------------------
create or replace function public.place_purchase_order(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_supplier_id uuid default null,
  p_expected_delivery_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role public.user_role; v_user_name text;
  v_po public.purchase_orders%rowtype;
begin
  if exists (select 1 from public.domain_events where id = p_event_id) then
    return;
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;

  if v_role not in ('OWNER','MANAGER','PROCUREMENT') then
    raise exception 'Rôle % non autorisé à passer commande', v_role;
  end if;

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
    organization_id, user_id, user_name, role, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_role,
    format('Commande passée %s', v_po.po_number), null,
    format('purchase_order:%s', v_po.po_number)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- receive_purchase_order — réception rattachée à la commande.
--
-- `receive_goods` reste pour l'achat de dépannage sans commande. Ici on
-- sait ce qui était attendu : le reste à livrer se déduit, et le statut
-- passe seul de PARTIALLY_RECEIVED à RECEIVED (§21).
-- ---------------------------------------------------------------------
create or replace function public.receive_purchase_order(
  p_event_id uuid,
  p_purchase_order_id uuid,
  p_location_id uuid,
  p_lines jsonb,            -- [{item_id, quantity, unit, unit_price}]
  p_transport_cost numeric default 0,
  p_payment_method text default 'CASH'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_user uuid := auth.uid(); v_role public.user_role; v_user_name text;
  v_po public.purchase_orders%rowtype;
  v_purchase_id uuid; v_line jsonb; v_goods numeric := 0; v_remaining numeric;
begin
  select entity_id into v_purchase_id from public.domain_events
    where id = p_event_id and event_type = 'GOODS_RECEIVED';
  if v_purchase_id is not null then
    return v_purchase_id;
  end if;

  select organization_id, role, name into v_org, v_role, v_user_name
    from public.profiles where id = v_user;

  if v_role not in ('OWNER','MANAGER','PROCUREMENT') then
    raise exception 'Rôle % non autorisé à réceptionner', v_role;
  end if;

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
    organization_id, user_id, user_name, role, action, detail, reference
  ) values (
    v_org, v_user, v_user_name, v_role,
    format('Réception %s', v_po.po_number),
    format('%s ligne(s) · %s FCFA', jsonb_array_length(p_lines),
           v_goods + coalesce(p_transport_cost, 0)),
    format('purchase_order:%s', v_po.po_number)
  );

  return v_purchase_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Comparaison multi-fournisseurs (§20)
--
-- Vues en security_invoker : elles lisent avec les droits de l'appelant,
-- donc RLS s'applique et une organisation ne voit pas les prix d'une
-- autre. Une vue SECURITY DEFINER a déjà fait fuiter le stock ici.
-- ---------------------------------------------------------------------

create or replace view public.supplier_item_prices
with (security_invoker = on) as
select
  po.organization_id,
  po.item_id,
  po.supplier_id,
  count(*)                                          as observations,
  min(po.unit_price)                                as min_price,
  max(po.unit_price)                                as max_price,
  round(avg(po.unit_price), 2)                      as avg_price,
  round(avg(po.unit_price) filter (
    where po.observed_at >= now() - interval '30 days'), 2) as avg_price_30d,
  round(avg(po.unit_price) filter (
    where po.observed_at >= now() - interval '7 days'), 2)  as avg_price_7d,
  (array_agg(po.unit_price order by po.observed_at desc))[1] as last_price,
  max(po.observed_at)                               as last_observed_at
from public.price_observations po
where po.supplier_id is not null
group by po.organization_id, po.item_id, po.supplier_id;

comment on view public.supplier_item_prices is
  'Historique de prix par article et par fournisseur. security_invoker : RLS de price_observations appliquee.';

-- Fiabilité de livraison : elle se déduit des commandes passées et des
-- réceptions, jamais d'une note saisie à la main.
create or replace view public.supplier_delivery_performance
with (security_invoker = on) as
with receipts as (
  select
    po.id                as purchase_order_id,
    po.organization_id,
    po.supplier_id,
    po.ordered_at,
    po.expected_delivery_at,
    min(p.received_at)   as first_received_at,
    max(p.received_at)   as last_received_at
  from public.purchase_orders po
  join public.purchases p on p.purchase_order_id = po.id
  where po.ordered_at is not null and p.received_at is not null
  group by po.id, po.organization_id, po.supplier_id, po.ordered_at, po.expected_delivery_at
)
select
  s.organization_id,
  s.id                                                    as supplier_id,
  s.name                                                  as supplier_name,
  s.lead_time_days                                        as declared_lead_time_days,
  count(r.purchase_order_id)                              as deliveries,
  count(*) filter (
    where r.expected_delivery_at is not null
      and r.first_received_at <= r.expected_delivery_at)  as on_time_deliveries,
  case when count(r.purchase_order_id) = 0 then null
       else round(100.0 * count(*) filter (
              where r.expected_delivery_at is not null
                and r.first_received_at <= r.expected_delivery_at)
            / count(r.purchase_order_id), 1)
  end                                                     as on_time_rate,
  round(avg(extract(epoch from (r.first_received_at - r.ordered_at)) / 86400.0)::numeric, 2)
                                                          as observed_lead_time_days,
  max(r.last_received_at)                                 as last_delivery_at
from public.suppliers s
left join receipts r on r.supplier_id = s.id
group by s.organization_id, s.id, s.name, s.lead_time_days;

comment on view public.supplier_delivery_performance is
  'Delai et fiabilite reels par fournisseur, derives des commandes et des receptions.';

-- ---------------------------------------------------------------------
-- compare_suppliers_for_item — la question posée à l'écran :
-- « pour cet article, qui me le vend à quel prix, en combien de temps,
--   et tient-il ses dates ? »
-- SECURITY INVOKER : la fonction ne lit rien que l'appelant ne puisse lire.
-- ---------------------------------------------------------------------
create or replace function public.compare_suppliers_for_item(
  p_item_id uuid,
  p_lookback_days int default 90
) returns table (
  supplier_id uuid,
  supplier_name text,
  last_price numeric,
  avg_price numeric,
  min_price numeric,
  max_price numeric,
  observations bigint,
  last_observed_at timestamptz,
  declared_lead_time_days int,
  observed_lead_time_days numeric,
  on_time_rate numeric,
  deliveries bigint,
  is_preferred boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id,
    s.name,
    (array_agg(o.unit_price order by o.observed_at desc))[1],
    round(avg(o.unit_price), 2),
    min(o.unit_price),
    max(o.unit_price),
    count(o.id),
    max(o.observed_at),
    s.lead_time_days,
    perf.observed_lead_time_days,
    perf.on_time_rate,
    perf.deliveries,
    coalesce(i.preferred_supplier_id = s.id, false)
  from public.suppliers s
  join public.items i on i.id = p_item_id
  left join public.price_observations o
         on o.supplier_id = s.id
        and o.item_id = p_item_id
        and o.observed_at >= now() - make_interval(days => greatest(p_lookback_days, 1))
  left join public.supplier_delivery_performance perf on perf.supplier_id = s.id
  where s.active
  group by s.id, s.name, s.lead_time_days, perf.observed_lead_time_days,
           perf.on_time_rate, perf.deliveries, i.preferred_supplier_id
  having count(o.id) > 0 or i.preferred_supplier_id = s.id
  order by 3 nulls last;
$$;

-- ---------------------------------------------------------------------
-- Droits d'exécution
--
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : révoquer pour `anon`
-- seul ne produit rien tant que la concession à PUBLIC subsiste.
-- ---------------------------------------------------------------------
revoke execute on function public.request_purchase(uuid, uuid, uuid, jsonb, date, text, text) from public, anon;
revoke execute on function public.approve_purchase_request(uuid, uuid, text)                  from public, anon;
revoke execute on function public.reject_purchase_request(uuid, uuid, text)                   from public, anon;
revoke execute on function public.place_purchase_order(uuid, uuid, uuid, timestamptz)         from public, anon;
revoke execute on function public.receive_purchase_order(uuid, uuid, uuid, jsonb, numeric, text) from public, anon;
revoke execute on function public.compare_suppliers_for_item(uuid, int)                       from public, anon;
-- Appelée uniquement par le trigger : personne ne doit pouvoir l'invoquer.
revoke execute on function public.enforce_purchase_order_transition() from public, anon, authenticated;

grant execute on function public.request_purchase(uuid, uuid, uuid, jsonb, date, text, text) to authenticated;
grant execute on function public.approve_purchase_request(uuid, uuid, text)                  to authenticated;
grant execute on function public.reject_purchase_request(uuid, uuid, text)                   to authenticated;
grant execute on function public.place_purchase_order(uuid, uuid, uuid, timestamptz)         to authenticated;
grant execute on function public.receive_purchase_order(uuid, uuid, uuid, jsonb, numeric, text) to authenticated;
grant execute on function public.compare_suppliers_for_item(uuid, int)                       to authenticated;
