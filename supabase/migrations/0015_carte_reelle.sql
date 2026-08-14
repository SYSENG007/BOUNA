-- 0015 — La carte réelle de BUNA.
--
-- Le catalogue portait encore cinq boissons de démonstration à 2 500 et
-- 3 000 FCFA, qui n'ont jamais été vendues. La vraie carte tient en trois
-- boissons déclinées en trois contenances, à 400 / 700 / 1 000 FCFA.
--
-- Chaque contenance est un article : le comptoir vend un bouton, et le prix
-- doit être porté par ce qu'on touche. Un article « Café » avec un sélecteur
-- de taille obligerait à deux gestes là où la vente doit en coûter un.
--
-- Toutes sont `MADE_TO_ORDER` : elles sont montées devant le client et n'ont
-- donc jamais de stock de produit fini. Les compter en `BATCH` les affichait
-- toutes en rupture au comptoir — invendables en permanence, puisqu'il
-- n'existe aucun stock d'un café qui n'a pas encore été commandé.
--
-- Sûr à rejouer : aucune vente, aucun mouvement, aucune recette ne référence
-- ces articles au moment de l'écrire (vérifié : les huit tables liées sont à
-- zéro). Les identifiants 15 à 19 existaient déjà et sont réécrits ; 20 à 23
-- sont créés.

begin;

-- Les cinq articles de démonstration deviennent les cinq premiers de la carte.
update public.items set
  name = v.name,
  price = v.price,
  production_mode = 'MADE_TO_ORDER',
  kind = 'FINISHED',
  unit = 'unite',
  -- Un produit monté à la commande n'a pas de seuil de réapprovisionnement :
  -- ce sont ses ingrédients qui en ont un.
  minimum_stock = null,
  target_stock = null,
  active = true
from (values
  ('55555555-0000-0000-0000-000000000015'::uuid, 'Café Touba · Petit',  400::numeric),
  ('55555555-0000-0000-0000-000000000016'::uuid, 'Café Touba · Moyen',  700::numeric),
  ('55555555-0000-0000-0000-000000000017'::uuid, 'Café Touba · Grand', 1000::numeric),
  ('55555555-0000-0000-0000-000000000018'::uuid, 'Café · Petit',        400::numeric),
  ('55555555-0000-0000-0000-000000000019'::uuid, 'Café · Moyen',        700::numeric)
) as v(id, name, price)
where public.items.id = v.id;

-- Les quatre qui manquaient.
insert into public.items (id, organization_id, name, kind, unit, price, production_mode, active)
select v.id,
       (select organization_id from public.items where id = '55555555-0000-0000-0000-000000000015'),
       v.name, 'FINISHED', 'unite', v.price, 'MADE_TO_ORDER', true
from (values
  ('55555555-0000-0000-0000-000000000020'::uuid, 'Café · Grand',      1000::numeric),
  ('55555555-0000-0000-0000-000000000021'::uuid, 'Chocolat · Petit',   400::numeric),
  ('55555555-0000-0000-0000-000000000022'::uuid, 'Chocolat · Moyen',   700::numeric),
  ('55555555-0000-0000-0000-000000000023'::uuid, 'Chocolat · Grand',  1000::numeric)
) as v(id, name, price)
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  production_mode = excluded.production_mode,
  active = true;

commit;
