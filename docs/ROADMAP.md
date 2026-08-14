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

**Écarts et recouvrements.** Caisse, stock et rendement produisent des écarts
datés. Un écart ouvert remonte au tableau de bord jusqu'à ce que quelqu'un lui
donne un motif. Le motif décide de ce qu'il coûte.

## À faire

1. **Brancher `domain/closing.ts`** — les cinq étapes de la clôture, le
   verrouillage de journée, la réouverture motivée. Écrit, testé, dormant.
2. **Appliquer les migrations 0009 et 0010** sur Supabase, puis vérifier en
   base : qu'un compte sans `RECEIVE_GOODS` se fait refuser `receive_goods`,
   que `has_capability` garde son `execute` pour `anon, authenticated`, et que
   la vue `capability_journal` est bien `security_invoker`.
3. **Écrans d'approbation d'achat et de fournisseurs** — les fonctions serveur
   existent, l'interface manque.
4. **Raccourcir les flux** feature par feature, et généraliser la saisie à
   l'aveugle au rendement de production.
5. **Notifications** — moteur de règles côté serveur, cooldown, Web Push.

## Vérifier

```bash
npm run typecheck && npm run test && npm run build
```

Sans backend, pour éprouver RULE-010 :

```bash
npm run dev:terrain
```
