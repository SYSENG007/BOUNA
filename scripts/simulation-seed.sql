-- =====================================================================
-- BUNA Operations — monter le bac à sable depuis un terminal
--
-- Le dispositif vit dans la base : voir `supabase/migrations/0029_bac_a_sable.sql`.
-- Ce fichier ne fait qu'appeler la fonction, pour qu'il n'existe qu'UNE
-- description du bac à sable. La version précédente recopiait le catalogue
-- ici et dans la fonction, et portait cet avertissement : « toute modification
-- doit être reportée dans l'autre fichier ». Une consigne de ce genre est un
-- défaut en attente.
--
-- Le chemin normal est l'application : Profil → Simuler une journée. Ce script
-- sert quand on veut préparer le bac à sable sans ouvrir l'interface — avant
-- une démonstration, par exemple.
--
-- Il ne crée AUCUN compte. Chacun entre en simulation avec le sien, et y garde
-- ses propres droits : c'est la question utile (« est-ce que MOI je peux tenir
-- une journée ? »), et cela évite un mot de passe partagé dans le dépôt.
-- =====================================================================

select public.build_simulation();

select
  (select name  from public.organizations where id = public.simulation_org_id()) as organisation,
  (select count(*) from public.items           where organization_id = public.simulation_org_id()) as articles,
  (select count(*) from public.suppliers       where organization_id = public.simulation_org_id()) as fournisseurs,
  (select count(*) from public.stock_movements where organization_id = public.simulation_org_id()) as mouvements_ouverture;

-- Les articles qui ouvrent sous leur minimum : la liste de courses du matin.
select i.name as article, sm.quantity as en_stock, i.minimum_stock as minimum
  from public.items i
  join public.stock_movements sm on sm.item_id = i.id
 where i.organization_id = public.simulation_org_id()
   and i.minimum_stock is not null
   and sm.quantity < i.minimum_stock
 order by i.name;
