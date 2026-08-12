# Feuille de route — PRD → implémentation

Correspondance entre les sprints du PRD et l'état du dépôt.

## Sprint 0 — Foundation ✅

| Élément | État | Où |
| --- | --- | --- |
| Project setup (Vite, TS, Tailwind, Router) | fait | racine |
| Design system | fait | `src/index.css`, `src/design-system/` |
| PWA shell (service worker, manifest, installable) | fait | `vite.config.ts` |
| RBAC | fait | `src/domain/permissions.ts` + RLS |
| Base locale | fait, à remplacer | `src/store/persist.ts` |
| Schéma PostgreSQL | fait | `supabase/migrations/0001_core.sql` |
| RLS | fait | `0002_rls.sql` |
| Authentication | **à faire** | Supabase Auth à brancher sur `Login.tsx` |
| PowerSync PoC | **à faire** | remplace `persist.ts` + `outbox.ts` |

## Sprint 1 — Catalogue & Stock ✅

Items, unités et conversions, emplacements, mouvements, requêtes de stock : `src/domain/`.
Couvert par 13 tests d'acceptation (`npm run test`).

## Sprint 2 — Procurement ◐

Fait : liste de courses calculée, achat, réception partielle, historique de prix,
impact coût moyen pondéré affiché avant validation.
À faire : PurchaseRequest et workflow d'approbation, comparaison multi-fournisseurs (§20).

## Sprint 3 — Production ◐

Fait : recettes versionnées et gelées, batch avec consommation déduite, rendement,
emplacement de destination.
À faire : mode « made to order » (§27-B), production recommandée par vitesse de vente (§29).

## Sprint 4 — POS ✅

Grille, appui long = −1, panier, quatre moyens de paiement, monnaie à rendre,
vente atomique, reçu montrant les déductions, annulation motivée.

## Sprint 5 — Cash & Closing ◐

Fait : session de caisse, clôture guidée avec attendu masqué, écart justifié, dépenses.
À faire : les 5 étapes complètes du daily closing (§37) et le verrouillage de journée (RULE-009).

## Sprint 6 — Notifications ◐

Fait : centre de notifications par rôle, sévérités, statuts, action proposée,
tables `notification_rules` / `notifications` / `push_subscriptions` / `notification_cooldowns`.
À faire : moteur de règles côté serveur, cooldown appliqué, Web Push, Supabase Queues + Cron.

## Sprint 7 — Analytics ◐

Fait : cockpit Owner (trois questions), KPI manager, top produits, dépenses par catégorie,
théorique vs réel sur la consommation.
À faire : agrégats semaine/mois côté PostgreSQL, analytics fournisseurs, rentabilité par heure et par site.

---

## Brancher Supabase

1. Créer le projet Supabase, récupérer l'URL et la clé anon.
2. Appliquer les migrations dans l'ordre : `0001_core.sql`, `0002_rls.sql`, `0003_transactions.sql`.
3. Créer une organisation, un site, des emplacements, puis les profils liés à `auth.users`.
4. Ajouter `.env.local` :

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

5. Remplacer la sélection de profil de `src/screens/Login.tsx` par Supabase Auth.
6. Brancher PowerSync : le contrat de `src/store/outbox.ts` (`Transport`) est déjà
   idempotent, le serveur dédoublonne sur `event.id`.

Les fonctions `complete_sale`, `void_sale` et `receive_goods` sont les points d'entrée
transactionnels : le client ne doit jamais écrire directement dans `sales` ou `stock_movements`.
