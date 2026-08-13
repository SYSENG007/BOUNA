# BUNA Operations — conventions

Système d'exploitation opérationnel de BUNA. PWA React 19 + TypeScript + Vite,
mobile-first, **offline-first**, français, adossée à Supabase/PostgreSQL.

## Les règles qui ne se négocient pas

**RULE-002 / RULE-003 — le stock est une projection.**
Il n'existe aucune colonne « niveau de stock », ni en TypeScript ni en PostgreSQL.
Le stock se calcule toujours à partir de `StockMovement[]`. Un écran qui affiche
un stock lit `stockOf()` ; un écran qui modifie un stock émet un mouvement.
Écrire un niveau de stock quelque part est un bug d'architecture, pas un raccourci.

**L'événement est l'unité fondamentale.** Le client n'envoie jamais un état, il
envoie des faits datés : `SALE −3`, `RECEIPT +10`, `WASTE −1`. Le serveur les
rejoue. C'est ce qui permet à plusieurs appareils d'être hors ligne en même temps
sans arbitrage de conflit.

**L'idempotence repose sur `event.id`**, un UUID généré côté client **avant toute
connexion réseau**. Chaque fonction transactionnelle PostgreSQL commence par
vérifier cet identifiant et renvoie la transaction existante s'il a déjà été
traité. Un retry réseau ne peut pas produire une seconde vente.

**RULE-010 — l'app doit fonctionner sans réseau.** Sans `.env.local`, le client
Supabase est `null` et tout continue sur l'état local. Aucune écriture ne doit
attendre le réseau. Une vente qui échoue parce que le réseau est absent est un
défaut bloquant.

**Le coût est en coût moyen pondéré (WAC).** Voir `weightedAverageCost()` dans
`src/domain/stock.ts` et `apply_weighted_average_cost` côté serveur.

## Sécurité

- La clé `service_role` ne doit **jamais** apparaître dans `.env.local`, dans le
  code client, ni dans un commit. Seule la clé `anon` est utilisée côté client :
  c'est RLS qui protège les données, pas le secret de la clé.
- Toute table exposée porte RLS. Toute vue est `security_invoker = on` — une vue
  `SECURITY DEFINER` contourne RLS et fuite les données entre organisations.
- Les fonctions qui écrivent (coûts, stocks) ont leur `EXECUTE` révoqué de
  `public` : Postgres l'accorde à `PUBLIC` par défaut, un `revoke ... from anon`
  seul ne fait rien.
- Les helpers de politique RLS (`current_org_id`, etc.) doivent **garder**
  `execute` pour `anon, authenticated` : les expressions de politique sont
  évaluées avec les privilèges de l'appelant. Les révoquer casse toutes les
  lectures.

## Voix de l'interface

Français, à la première personne de l'utilisateur, jamais de jargon système.
« Stock lait entier faible », pas « LOW_STOCK_ALERT ». Une erreur dit ce qui
s'est passé et comment le réparer. Un bouton nomme exactement son effet, et le
message de confirmation reprend le même mot.

Les commentaires de code sont en français et expliquent le *pourquoi* — la
décision, la contrainte terrain — jamais la paraphrase du code.

## Design system

Tokens dans `src/index.css` (`@theme`). Ne pas introduire de couleur en dur :
café/brun/or pour la marque, ink-\* pour les neutres chauds, conforme/surveiller/
critique/info pour le sémantique. Jamais de rouge pur.

**La signature du produit est le filet doré `.derived`.** Il marque ce que le
système *déduit* — stock, coût, marge, rendement — et jamais ce que
l'utilisateur *déclare*. C'est « déclarer, pas saisir » rendu visible. Ne pas
l'utiliser comme décoration.

Coque : `--nav-rail` (rail latéral ≥1024px) et `--tabbar-h` (barre d'onglets au
terrain) portent la bascule. Toute barre d'action ancrée en bas utilise la classe
`.rail-bar`, jamais `fixed inset-x-0` — sinon elle passe sous le rail.

Cibles tactiles : `--spacing-touch` (44px) minimum, `--spacing-counter` (56px)
pour les actions du comptoir.

## Structure

```
src/domain/     logique pure, testable, sans React ni réseau
src/store/      état local offline-first + file de synchronisation
src/backend/    Supabase : client, auth, transport d'événements
src/screens/    un dossier par rôle
src/design-system/  primitives, motifs, icônes
supabase/migrations/  SQL numéroté, appliqué dans l'ordre
```

## Vérifier

```bash
npm run typecheck && npm run test && npm run build
```

Les tests d'acceptation dérivent du §107 du PRD. Une règle du PRD qui n'a pas de
test n'est pas tenue pour acquise.

Vérifier plutôt que supposer : un cache PostgREST périmé, un `revoke` sans effet
ou une vue `SECURITY DEFINER` se voient uniquement en interrogeant la base.
