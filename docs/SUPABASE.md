# Brancher Supabase

L'application fonctionne sans backend. Ce guide la relie à PostgreSQL sans rien
casser : tant que `.env.local` n'existe pas, tout continue sur l'état local.

## 1. Créer le projet

Sur [supabase.com](https://supabase.com) → **New project**.
Choisissez la région la plus proche de Dakar (`eu-west-3` Paris est le meilleur
compromis latence/disponibilité aujourd'hui).

Notez le mot de passe de la base : il n'est plus affiché ensuite.

## 2. Appliquer les migrations

**Project → SQL Editor → New query**, puis exécutez dans cet ordre :

1. `supabase/migrations/0001_core.sql` — tables, types, vue `stock_levels`
2. `supabase/migrations/0002_rls.sql` — Row Level Security par rôle
3. `supabase/migrations/0003_transactions.sql` — `complete_sale`, `void_sale`, `receive_goods`

Chaque fichier est idempotent à l'échelle du projet neuf : exécutez-les une fois,
dans l'ordre. `0002` dépend des tables de `0001`, `0003` dépend de la vue.

## 3. Renseigner les clés

**Project Settings → API** donne l'URL et la clé `anon`.

```bash
cp .env.example .env.local
```

Renseignez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`, puis relancez
`npm run dev`. La clé `anon` est publique par conception — c'est RLS qui protège
les données. **Ne mettez jamais la clé `service_role` dans ce fichier.**

## 4. Créer l'organisation et les profils

Toujours dans le SQL Editor :

```sql
-- Organisation et site
insert into organizations (id, name, currency, timezone)
values ('00000000-0000-0000-0000-000000000001', 'BUNA', 'XOF', 'Africa/Dakar');

insert into sites (id, organization_id, name)
values ('00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001', 'Coffee Bar Auchan');

insert into stock_locations (site_id, name, type) values
  ('00000000-0000-0000-0000-000000000002', 'Stock principal', 'CENTRAL'),
  ('00000000-0000-0000-0000-000000000002', 'Cuisine',         'KITCHEN'),
  ('00000000-0000-0000-0000-000000000002', 'Frigo',           'FRIDGE'),
  ('00000000-0000-0000-0000-000000000002', 'Coffee Bar Auchan','POS');
```

Créez ensuite les comptes dans **Authentication → Users**, puis rattachez chaque
compte à un profil (l'`id` doit être celui de `auth.users`) :

```sql
insert into profiles (id, organization_id, site_id, name, role)
values ('<uuid-de-auth.users>',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        'Aïcha Ndiaye', 'SELLER');
```

Rôles disponibles : `OWNER`, `MANAGER`, `PROCUREMENT`, `PREPARER`, `SELLER`, `FINANCE`.

## 5. Vérifier RLS

Connectez-vous en tant que vendeur et lancez, depuis l'app ou le SQL Editor en
mode authentifié :

```sql
select * from sales;
```

Un vendeur ne doit voir que ses propres ventes ; un manager les voit toutes.
Si un vendeur voit tout, RLS n'est pas actif — vérifiez que `0002_rls.sql` est
bien passé en entier.

## 6. Ce qui reste manuel

- **Authentification** : `src/screens/Login.tsx` sélectionne encore un profil de
  démonstration. Le remplacement par `supabase.auth.signInWithPassword` ne touche
  que cet écran ; les rôles et permissions sont déjà en place.
- **PowerSync** : `src/store/persist.ts` (base locale) et `src/store/outbox.ts`
  (file d'attente) sont les deux seuls fichiers à remplacer. Le contrat
  `Transport` est déjà idempotent.
- **Photos** : elles sont stockées en data URL locale. Pour Supabase Storage,
  créez un bucket `products` et remplacez le retour de
  `src/domain/image.ts` par le chemin uploadé.

## Comment la synchronisation fonctionne

Le client n'envoie jamais un niveau de stock. Il envoie des faits :

```
SALE −3 · RECEIPT +10 · WASTE −1 · ADJUSTMENT +0,4
```

Le serveur les rejoue et reconstruit l'état. C'est ce qui permet à plusieurs
appareils d'être hors ligne en même temps sans conflit à arbitrer.

Chaque événement porte un UUID généré **avant** toute connexion. Les fonctions
`complete_sale`, `void_sale` et `receive_goods` commencent par vérifier cet
identifiant et renvoient la transaction existante s'il a déjà été traité — un
retry réseau ne peut pas produire une seconde vente.
