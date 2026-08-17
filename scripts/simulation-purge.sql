-- =====================================================================
-- BUNA Operations — effacer le bac à sable depuis un terminal
--
-- Le dispositif vit dans la base : voir `supabase/migrations/0029_bac_a_sable.sql`.
-- `purge_simulation()` ramène d'abord toute personne encore en simulation dans
-- sa maison d'origine, puis supprime l'organisation. L'ordre compte :
-- `profiles.organization_id` cascade depuis `organizations`, donc supprimer
-- pendant qu'un profil désigne le bac à sable détruirait le compte.
--
-- La fonction refuse d'agir si l'organisation visée ne s'appelle pas
-- « BUNA — Simulation ». L'organisation réelle s'appelle « BUNA » : elle ne peut
-- pas passer ce test.
--
-- Appelée depuis psql, `auth.uid()` est nul et la fonction refuserait. On lui
-- présente donc le propriétaire de la maison, le temps de l'appel.
-- =====================================================================

begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select p.id from public.profiles p
             where p.organization_id <> public.simulation_org_id()
               and p.post = 'OWNER'
             order by p.created_at limit 1),
    'role', 'authenticated'
  )::text,
  true
);

select public.purge_simulation();

commit;

-- Contrôle : les deux compteurs doivent être à zéro.
select
  (select count(*) from public.organizations where id = public.simulation_org_id()) as organisations_simu,
  (select count(*) from public.profiles where home_organization_id is not null)     as personnes_restees_dehors,
  (select count(*) from public.organizations)                                       as organisations_restantes;
