-- 0026 — Le registre des migrations appliquées.
--
-- Ce fichier existe à cause d'un défaut réel, pas d'un principe.
--
-- `0024_regime_exploitation.sql` accorde `MANAGE_SETTINGS` aux postes
-- `('OWNER','MANAGER')`. C'est ce que dit le fichier committé. Ce n'est pas ce
-- qui a tourné : la version réellement appliquée, le 2026-08-17 à 10:33, ne
-- couvrait que le propriétaire. Le fichier a été étendu ensuite — et une
-- migration ne se rejoue pas. Deux managers sont restés sans la capacité
-- pendant que le dépôt affirmait le contraire, et rien, nulle part, ne pouvait
-- le dire : relire le `.sql` ne prouve rien sur l'état de la base.
--
-- La cause tient au mode d'exploitation, pas à une étourderie : les migrations
-- s'appliquent à la main depuis l'arbre de travail (`scripts/db-apply.sh`),
-- souvent avant d'être committées, donc l'écart entre « le fichier » et « ce
-- qui a tourné » est la situation NORMALE, pas l'accident.
--
-- Le registre ferme l'écart : chaque application enregistre le nom du fichier
-- ET l'empreinte de son contenu. `db-apply.sh` compare avant d'appliquer et
-- refuse un fichier modifié depuis son application. Le dépôt cesse d'être une
-- affirmation invérifiable sur la base.

create table if not exists public.schema_migrations (
  filename    text primary key,
  -- sha256 du fichier tel qu'appliqué. NULL = « adoptée » : présumée appliquée
  -- à la création du registre, contenu jamais vérifié. Cette nuance est le
  -- coeur du fichier — prétendre connaître l'empreinte de 0001 à 0025
  -- reproduirait exactement le mensonge qu'on corrige.
  checksum    text,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user,
  note        text
);

comment on table public.schema_migrations is
  'Quelle migration a réellement tourné, et avec quel contenu. Renseigné par '
  'scripts/db-apply.sh. checksum NULL = adoptée à la création du registre, '
  'contenu non vérifié.';

-- RLS active sans aucune politique : la table est invisible depuis PostgREST.
-- L'historique de migration n'a rien à faire dans une réponse d'API — il
-- décrit la forme du serveur, ce qu'un client n'a aucune raison de lire.
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

-- --------------------------------------------------------------- Adoption

-- Tout ce qui a tourné avant l'existence du registre, déclaré tel quel, sans
-- empreinte. `on conflict do nothing` : si db-apply.sh a déjà enregistré l'une
-- d'elles avec une vraie empreinte, on ne l'écrase pas par un aveu d'ignorance.
insert into public.schema_migrations (filename, checksum, note) values
  ('0001_core.sql', null, 'adoptée à la création du registre'),
  ('0002_rls.sql', null, 'adoptée à la création du registre'),
  ('0003_transactions.sql', null, 'adoptée à la création du registre'),
  ('0004_security_hardening.sql', null, 'adoptée à la création du registre'),
  ('0005_profile_on_signup.sql', null, 'adoptée à la création du registre'),
  ('0006_rls_hardening_and_indexes.sql', null, 'adoptée à la création du registre'),
  ('0007_purchase_requests.sql', null, 'adoptée à la création du registre'),
  ('0008_production_modes.sql', null, 'adoptée à la création du registre'),
  ('0009_capabilities.sql', null, 'adoptée à la création du registre'),
  ('0010_actor_trace.sql', null, 'adoptée à la création du registre'),
  ('0011_missing_production_objects.sql', null, 'adoptée à la création du registre'),
  ('0012_actor_propagation.sql', null, 'adoptée à la création du registre'),
  ('0013_notification_cooldowns_rls.sql', null, 'adoptée à la création du registre'),
  ('0014_durable_events.sql', null, 'adoptée à la création du registre'),
  ('0015_carte_reelle.sql', null, 'adoptée à la création du registre'),
  ('0016_revoke_anon_execute.sql', null, 'adoptée à la création du registre'),
  ('0017_revoke_anon_on_durable_events.sql', null, 'adoptée à la création du registre'),
  ('0018_reject_negative_counts.sql', null, 'adoptée à la création du registre'),
  ('0019_debt_tracking.sql', null, 'adoptée à la création du registre'),
  ('0020_debt_functions.sql', null, 'adoptée à la création du registre'),
  ('0021_resolve_variance.sql', null, 'adoptée à la création du registre'),
  ('0022_preparation_sans_recette.sql', null, 'adoptée à la création du registre'),
  ('0023_capacite_reglages.sql', null, 'adoptée à la création du registre'),
  ('0024_regime_exploitation.sql', null, 'adoptée à la création du registre'),
  ('0025_declencheur_prereglages.sql', null, 'adoptée à la création du registre')
on conflict (filename) do nothing;

-- 0024 mérite sa mention : c'est elle qui a révélé le besoin de ce registre,
-- et c'est la seule dont on SAIT que le fichier diffère de ce qui a tourné.
update public.schema_migrations
   set note = 'adoptée — le fichier committé DIFFÈRE de ce qui a tourné : '
              'le rattrapage MANAGE_SETTINGS n''a atteint que le propriétaire. '
              'Rattrapé par 0025.'
 where filename = '0024_regime_exploitation.sql';

do $$
declare v_n int;
begin
  select count(*) into v_n from public.schema_migrations;
  if v_n < 25 then
    raise exception 'Le registre ne contient que % lignes : adoption incomplète.', v_n;
  end if;
end $$;
