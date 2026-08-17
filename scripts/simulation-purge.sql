-- =====================================================================
-- BUNA Operations — fin de simulation
--
-- Efface le bac à sable, et rien d'autre.
--
-- Tout ce que la simulation a produit — ventes, mouvements, dépenses,
-- préparations, écarts, notifications, journal — porte l'`organization_id`
-- du bac à sable, parce que RLS n'a jamais laissé le choix : un compte de
-- simulation ne peut écrire que dans son organisation. Supprimer la ligne
-- `organizations` suffit donc à tout emporter, en cascade, dans le bon ordre,
-- sans qu'aucune table ne puisse être oubliée.
--
-- C'est la raison d'être de ce dispositif : la purge tient en un prédicat.
-- Une colonne `is_simulation` semée dans quinze tables aurait demandé quinze
-- suppressions, quinze filtres dans les rapports, et aurait laissé une chance
-- au chiffre d'affaires réel d'avaler une vente fictive.
--
-- Usage :
--   scripts/db-psql.sh -f supabase/../scripts/simulation-purge.sql
--   ou : coller dans Supabase → SQL Editor
-- =====================================================================

do $$
declare
  -- L'organisation de simulation. Famille d'identifiants en 9 : la maison
  -- réelle est en 1, son site en 2, ses emplacements en 3, ses fournisseurs
  -- en 4. Un 9 en tête se lit d'un coup d'œil dans n'importe quelle requête.
  c_org      constant uuid := '99999999-9999-9999-9999-999999999999';
  -- Le nom fait office de second verrou. Voir le garde-fou ci-dessous.
  c_nom      constant text := 'BUNA — Simulation';
  -- Un domaine à part : le prédicat de suppression des comptes ne peut pas
  -- déborder sur @buna.sn, quel que soit le nom qu'on donne à un compte.
  c_courriel constant text := '%@simu.buna.sn';

  v_nom      text;
  v_comptes  integer;
begin
  select name into v_nom from public.organizations where id = c_org;

  /*
   * Le garde-fou.
   *
   * On ne supprime pas « l'organisation dont l'identifiant est c_org » : on
   * supprime « l'organisation qui s'appelle BUNA — Simulation ». Si les deux
   * ne coïncident pas, quelqu'un a réutilisé l'identifiant pour autre chose
   * et la suite serait une destruction de données réelles. On s'arrête, et
   * comme tout est dans une seule transaction, rien n'a bougé.
   *
   * L'organisation réelle s'appelle « BUNA ». Elle ne peut donc pas passer
   * ce test, même si on collait son identifiant dans c_org par erreur.
   */
  if v_nom is null then
    raise notice 'Aucune simulation en cours : l''organisation % n''existe pas.', c_org;
  elsif v_nom is distinct from c_nom then
    raise exception
      'REFUS : l''organisation % s''appelle « % », pas « % ». Rien n''a été supprimé.',
      c_org, v_nom, c_nom;
  else
    /*
     * Les tables de lignes, d'abord.
     *
     * Cinq d'entre elles référencent `items` en NO ACTION et ne portent pas
     * d'`organization_id` : la cascade depuis `organizations` supprime `items`
     * ET leur table parente dans la même instruction, sans garantie que la
     * ligne fille soit partie avant que la contrainte sur `items` ne soit
     * vérifiée. La suppression échoue alors sur
     * « violates foreign key constraint sale_lines_item_id_fkey ».
     *
     * Le défaut ne se voit que sur une simulation qui a réellement vendu ou
     * acheté quelque chose — un bac à sable vide se supprime très bien. On
     * retire donc ces lignes explicitement, en les rattachant à l'organisation
     * par leur parent.
     *
     * Toute modification ici doit être reportée dans `simulation-seed.sql`,
     * dont l'étape 0 efface la simulation précédente de la même façon.
     */
    delete from public.sale_lines
     where sale_id in (select id from public.sales where organization_id = c_org);

    delete from public.purchase_lines
     where purchase_id in (select id from public.purchases where organization_id = c_org);

    delete from public.purchase_order_lines
     where purchase_order_id in (select id from public.purchase_orders where organization_id = c_org);

    delete from public.inventory_count_lines
     where inventory_count_id in (select id from public.inventory_counts where organization_id = c_org);

    delete from public.recipe_ingredients
     where recipe_version_id in (
       select v.id from public.recipe_versions v
         join public.recipes r on r.id = v.recipe_id
        where r.organization_id = c_org
     );

    delete from public.organizations where id = c_org;
    raise notice 'Bac à sable supprimé — la cascade a emporté articles, mouvements, ventes, dépenses, préparations, écarts, événements et journal.';
  end if;

  /*
   * Les comptes Auth survivent à la cascade : `profiles` référence
   * `auth.users`, pas l'inverse. Sans ceci, chaque simulation laisserait
   * derrière elle des comptes capables de se connecter sans profil — donc
   * sans organisation, donc devant une application vide et incompréhensible.
   */
  delete from auth.users where email like c_courriel;
  get diagnostics v_comptes = row_count;
  raise notice 'Comptes de simulation supprimés : %.', v_comptes;
end $$;

-- Contrôle : les deux compteurs doivent être à zéro.
select
  (select count(*) from public.organizations where id = '99999999-9999-9999-9999-999999999999') as organisations_simu,
  (select count(*) from auth.users where email like '%@simu.buna.sn')                           as comptes_simu,
  (select count(*) from public.organizations)                                                   as organisations_restantes;
