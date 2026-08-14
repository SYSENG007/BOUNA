# Feuille de route

## Fait

**Socle capacités.** Le poste n'autorise plus rien ; la capacité, accordée et
révocable, décide. 25 capacités, 6 features, un registre unique dont dérivent
les routes, la navigation, le tiroir d'opérations et l'écran de délégation.
Côté serveur : `has_capability()`, 43 politiques réécrites, 9 fonctions
transactionnelles gardées. Voir `docs/ARCHITECTURE-V2.md`.

**Traçabilité.** Chaque fait porte un `Actor` — qui, quand, depuis quel appareil,
et **sous quelle capacité**. Rendu partout par `<ActorStamp>`.

**Tableau de bord unifié.** `Today` et `Cockpit` fusionnés. `analytics.ts` enfin
branché : agrégats de période, série comparée, rentabilité horaire, marge par
produit. Six primitives graphiques SVG, sans dépendance.

**Trésorerie.** `domain/cashflow.ts` : entrées et sorties par moyen de paiement,
solde cumulé, autonomie, coût estimé du réapprovisionnement.

**Écarts et recouvrements.** La caisse et le stock produisent des écarts
datés — le rendement de production reste à brancher (`VarianceSource = 'YIELD'`
est déclarée mais alimentée par rien). Un écart ouvert remonte au tableau de bord jusqu'à ce que quelqu'un lui
donne un motif. Le motif décide de ce qu'il coûte.

## À faire

Deux verrous conditionnent la suite, et aucun n'est technique :

- **La limite de dépense mensuelle du compte Claude.** Les quatre agents lancés
  s'y sont arrêtés net, en pleine lecture, sans rien écrire.
- **Le connecteur MCP Supabase n'est pas autorisé.** C'est lui qui permet
  d'appliquer les migrations sans qu'un mot de passe transite par qui que ce
  soit. À autoriser depuis un terminal interactif.

Puis, dans cet ordre :

1. **Appliquer 0009 et 0010** sur le projet distant. Sauvegarde d'abord
   (`scripts/db-backup.sh`), application ensuite (`scripts/db-apply.sh`), preuve
   enfin (`supabase/verify_invariants.sql`). Le DDL étant transactionnel, un
   échec laisse la base intacte.
2. **Brancher `domain/closing.ts`** — les cinq étapes de la clôture, le
   verrouillage de journée, la réouverture motivée. 1 341 lignes écrites et
   testées, importées par aucun écran. Donne enfin une interface à `REOPEN_DAY`.
3. **Écrans d'approbation d'achat et de fournisseurs** — `approve_purchase_request`
   et `reject_purchase_request` existent et sont gardées ; l'interface manque,
   donc les deux capacités s'accordent sans mener nulle part.
4. **Saisie à l'aveugle du rendement de production**, sur le modèle de
   l'inventaire : le préparateur déclare ce qu'il a obtenu, le système révèle
   ensuite l'attendu et l'écart valorisé au coût moyen pondéré. C'est ce qui
   alimentera enfin `VarianceSource = 'YIELD'`.
5. **Raccourcir les flux** feature par feature.
6. **Notifications** — moteur de règles côté serveur, cooldown, Web Push.
   Séquencé après l'application des migrations : les règles vivent en base et
   `recipient_roles` a été remplacée par les capacités destinataires.

## Déployer

Cloudflare Pages. `public/_headers` et `public/_redirects` portent ce que
`vercel.json` portait : repli SPA, service worker jamais mis en cache, bundles
hachés immuables un an.

```bash
npm run build        # produit dist/
```

## Vérifier

```bash
npm run typecheck && npm run test && npm run build
```

Sans backend, pour éprouver RULE-010 :

```bash
npm run dev:terrain
```
