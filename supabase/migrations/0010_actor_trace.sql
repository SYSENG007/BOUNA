-- =====================================================================
-- 0010 — Qui a fait quoi, et sous quelle autorisation.
--
-- La traçabilité existait déjà en données : `sales.seller_id`,
-- `stock_movements.user_id`, `expenses.user_id`. Trois choses manquaient.
--
--   1. `purchases` n'avait AUCUN auteur — l'opération la plus sensible
--      financièrement était la seule anonyme.
--   2. Le nom n'était jamais figé. Un identifiant seul devient illisible
--      dès qu'une personne quitte l'équipe, et RLS masque les profils
--      aux yeux d'un vendeur : l'historique cessait d'être lisible pour
--      ceux qui en ont le plus besoin.
--   3. Rien ne disait SOUS QUELLE CAPACITÉ l'opération avait été faite.
--      C'est ce qui permet, trois semaines plus tard, de répondre à
--      « de qui tenait-il le droit de réceptionner ce jour-là ? ».
--
-- Les colonnes historiques restent : elles portent les clés étrangères
-- et les politiques RLS. Le tampon les complète, il ne les remplace pas.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. LE TAMPON
--
-- Dénormalisé exprès. `actor_user_name` et `actor_post` figent l'état au
-- moment du fait : un historique qui se réécrirait quand quelqu'un change
-- de poste ne serait plus un historique.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'stock_movements','sales','purchases','production_batches',
    'expenses','waste_events','inventory_counts'
  ]
  loop
    execute format($f$
      alter table public.%I
        add column if not exists actor_user_id   uuid references public.profiles(id),
        add column if not exists actor_user_name text,
        add column if not exists actor_post      public.user_post,
        add column if not exists actor_capability public.capability,
        add column if not exists actor_at        timestamptz
    $f$, t);
  end loop;
end $$;

-- `device_id` manquait là où il n'y avait pas de mouvement : un même
-- compte ouvert sur deux téléphones produit deux flux à démêler.
alter table public.sales             add column if not exists device_id text;
alter table public.purchases         add column if not exists device_id text;
alter table public.expenses          add column if not exists device_id text;
alter table public.waste_events      add column if not exists device_id text;
alter table public.production_batches add column if not exists device_id text;
alter table public.inventory_counts  add column if not exists device_id text;

-- ---------------------------------------------------------------------
-- 2. REPRISE DE L'EXISTANT
--
-- On remplit ce qu'on peut déduire sans rien inventer : l'auteur quand
-- une colonne le donnait, son nom et son poste ACTUELS faute de mieux.
-- La capacité mobilisée, elle, reste NULLE sur l'historique — elle n'a
-- jamais été enregistrée, et la déduire du poste d'aujourd'hui
-- fabriquerait une autorisation qui n'a peut-être jamais existé.
-- L'application affiche « auteur inconnu » plutôt qu'un auteur plausible.
-- ---------------------------------------------------------------------

update public.stock_movements m set
  actor_user_id = m.user_id, actor_user_name = p.name,
  actor_post = p.post, actor_at = m.created_at
from public.profiles p where p.id = m.user_id and m.actor_user_id is null;

update public.sales s set
  actor_user_id = s.seller_id, actor_user_name = p.name,
  actor_post = p.post, actor_at = s.created_at
from public.profiles p where p.id = s.seller_id and s.actor_user_id is null;

update public.production_batches b set
  actor_user_id = b.preparer_id, actor_user_name = p.name,
  actor_post = p.post, actor_at = b.started_at
from public.profiles p where p.id = b.preparer_id and b.actor_user_id is null;

update public.expenses e set
  actor_user_id = e.user_id, actor_user_name = p.name,
  actor_post = p.post, actor_at = e.created_at
from public.profiles p where p.id = e.user_id and e.actor_user_id is null;

update public.waste_events w set
  actor_user_id = w.user_id, actor_user_name = p.name,
  actor_post = p.post, actor_at = w.created_at
from public.profiles p where p.id = w.user_id and w.actor_user_id is null;

update public.inventory_counts c set
  actor_user_id = c.user_id, actor_user_name = p.name,
  actor_post = p.post, actor_at = c.created_at
from public.profiles p where p.id = c.user_id and c.actor_user_id is null;

-- `purchases` n'a rien à reprendre : personne n'y a jamais été enregistré.

-- ---------------------------------------------------------------------
-- 3. LES ÉCARTS
--
-- Un écart constaté n'est pas une information, c'est une question
-- ouverte. Jusqu'ici la caisse gardait la sienne dans la clôture et le
-- stock la sienne dans l'inventaire, et aucune ne se soldait.
--
-- Le motif décide de ce que l'écart coûte : une erreur de saisie
-- corrigée ne coûte rien, une perte ou un vol, si. C'est pour ça que le
-- motif est obligatoire pour refermer.
-- ---------------------------------------------------------------------

create type public.variance_source as enum ('CASH','STOCK','YIELD');
create type public.variance_resolution as enum
  ('PERTE','ERREUR_SAISIE','OFFERT','VOL','AJUSTEMENT');

create table public.variances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id),
  source public.variance_source not null,
  reference_id uuid not null,
  subject text not null,
  theoretical numeric(14,4) not null,
  declared numeric(14,4) not null,
  delta numeric(14,4) not null,
  -- Toujours positif : c'est un montant en jeu, pas une direction.
  amount numeric(14,2) not null check (amount >= 0),

  actor_user_id uuid references public.profiles(id),
  actor_user_name text not null,
  actor_post public.user_post,
  actor_capability public.capability,
  created_at timestamptz not null default now(),

  resolution public.variance_resolution,
  resolution_note text,
  resolver_user_id uuid references public.profiles(id),
  resolver_user_name text,
  resolved_at timestamptz,

  -- Un écart soldé porte forcément son auteur et sa date. L'inverse
  -- aussi : pas de résolution sans motif.
  constraint resolution_complete check (
    (resolution is null and resolved_at is null and resolver_user_id is null)
    or (resolution is not null and resolved_at is not null and resolver_user_id is not null)
  )
);

create index variances_open on public.variances (organization_id, created_at desc)
  where resolution is null;
create index variances_reference on public.variances (reference_id);

alter table public.variances enable row level security;

create policy variances_read on public.variances
  for select
  using (organization_id = (select public.current_org_id())
         and ((select public.has_capability('RESOLVE_VARIANCE'))
              or (select public.has_capability('VIEW_FINANCES'))));

-- Constater un écart, c'est le produit d'un comptage ou d'une clôture :
-- celui qui peut compter peut donc en ouvrir un.
create policy variances_insert on public.variances
  for insert to authenticated
  with check (organization_id = (select public.current_org_id())
              and ((select public.has_capability('COUNT_INVENTORY'))
                   or (select public.has_capability('MANAGE_CASH_SESSION'))
                   or (select public.has_capability('PRODUCE'))));

-- On ne rouvre pas un écart soldé : le premier motif fait foi. Le
-- `using` l'impose, pas seulement l'application.
create policy variances_resolve on public.variances
  for update to authenticated
  using (organization_id = (select public.current_org_id())
         and resolution is null
         and (select public.has_capability('RESOLVE_VARIANCE')))
  with check (resolution is not null and resolver_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 4. LE JOURNAL DES DÉLÉGATIONS, EN LECTURE
--
-- `security_invoker = on` : une vue en SECURITY DEFINER contournerait
-- RLS et laisserait fuiter les accès d'une organisation vers une autre.
-- ---------------------------------------------------------------------

create or replace view public.capability_journal
with (security_invoker = on) as
select
  uc.id,
  uc.organization_id,
  uc.user_id,
  holder.name as user_name,
  holder.post as user_post,
  uc.capability,
  uc.granted_at,
  granter.name as granted_by_name,
  uc.revoked_at,
  revoker.name as revoked_by_name,
  (uc.revoked_at is null) as active
from public.user_capabilities uc
join public.profiles holder on holder.id = uc.user_id
left join public.profiles granter on granter.id = uc.granted_by
left join public.profiles revoker on revoker.id = uc.revoked_by;

commit;
