# BUNA Operations

Le système d'exploitation opérationnel de BUNA.

**Besoin → Approvisionnement → Achat → Réception → Stock → Préparation → Vente → Paiement → Clôture → Analyse**

PWA mobile-first, offline-first, event-driven. React + TypeScript + Vite, Supabase/PostgreSQL,
synchronisation PowerSync.

---

## Démarrer

```bash
npm install
```

```bash
npm run dev
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` | build de production (PWA incluse) |
| `npm run test` | tests d'acceptation métier (§107 du PRD) |
| `npm run typecheck` | vérification TypeScript stricte |

L'application démarre sur un écran de sélection de profil : chaque rôle ouvre sa propre
navigation et ses propres permissions.

---

## Principes non négociables

Ces règles sont encodées dans le code et dans le schéma, pas seulement documentées.

| Règle | Où elle vit |
| --- | --- |
| RULE-001 — aucune vente finalisée n'est supprimée | `void_sale()`, policy `sales_void`, absence de policy DELETE |
| RULE-002 — aucun stock n'est modifié directement | `src/domain/stock.ts`, vue `stock_levels`, pas de colonne de niveau |
| RULE-003 — toute correction produit un StockMovement | `recordWaste`, `transferStock`, `void_sale()` |
| RULE-004 — toute transaction critique a une clé d'idempotence | `uuid()` généré avant réseau, `domain_events.id` en PK |
| RULE-005 — une recette utilisée n'est pas réécrite | `recipe_versions.frozen`, policy `recipe_versions_update` |
| RULE-008 — toute correction sensible a un motif | écran Perte, `void_sale()` lève sans motif |
| RULE-010 — le hors-ligne ne bloque aucune opération P0 | store local synchrone, file d'attente d'événements |

---

## Architecture

```
PWA (React + TS)
  └── état local synchrone  ← lecture/écriture immédiate, sans réseau
       └── file d'événements (LOCAL_ONLY → QUEUED → SYNCING → SYNCED)
            └── PowerSync
                 └── Supabase / PostgreSQL  ← autorité métier
                      ├── RLS + rôles
                      ├── fonctions transactionnelles atomiques
                      └── audit non modifiable
```

Le client ne synchronise jamais un niveau de stock. Il envoie des faits
(`SALE −3`, `RECEIPT +10`, `WASTE −1`) et le serveur reconstruit l'état. C'est ce qui
permet à plusieurs appareils d'être hors ligne simultanément sans conflit.

### Carte du code

| Chemin | Contenu |
| --- | --- |
| `src/index.css` | tokens du BUNA Design System (couleurs, typo, rayons, ombres, cibles tactiles) |
| `src/design-system/` | primitives et motifs : boutons, champs, badges, KPI, lignes de stock, navigation |
| `src/domain/` | noyau métier pur, testable : types, moteur de stock, coût moyen pondéré, unités, RBAC |
| `src/store/` | état offline-first, transactions atomiques, file de synchronisation |
| `src/screens/` | écrans par rôle |
| `supabase/migrations/` | schéma, RLS, fonctions transactionnelles |

---

## État d'avancement

Le PRD décrit sept sprints. Ce dépôt couvre :

**Fait**
- Sprint 0 — setup, design system, PWA shell, RBAC, base locale, schéma PostgreSQL + RLS
- Sprint 1 — catalogue, unités et conversions, emplacements, moteur de mouvements
- Sprint 4 — POS complet : grille, panier, encaissement, reçu, annulation motivée
- Production : besoins, batch avec consommation déduite et rendement
- Stock : projection, santé, théorique vs réel, perte motivée
- Achat & réception avec impact coût moyen pondéré et historique de prix
- Manager : KPI du jour, alertes actionnables, clôture de caisse guidée
- Owner : cockpit trois questions · Finance : dépenses + journal d'audit
- Notifications in-app par rôle avec action proposée

**Reste à brancher**
- Supabase réel : créer le projet, appliquer les migrations, activer Auth
- PowerSync : remplacer `src/store/persist.ts` et `outbox.ts` par le client PowerSync
- Web Push et le moteur de règles de notification (Sprint 6)
- Inventaire complet avec ajustements validés (§24)
- Analytics multi-période côté serveur (Sprint 7)

Détail dans [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Marque

Le logo vit dans `public/brand/buna-logo.svg`. Le composant `BunaMark` reproduit la
pastille café + point or utilisée dans l'interface ; remplacez-le par le logo vectoriel
si vous voulez le tracé complet dans l'app.
