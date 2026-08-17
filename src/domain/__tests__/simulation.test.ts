import { describe, expect, it } from 'vitest';
import { SIMULATION_ORG_ID, isSimulation } from '../simulation';
import { awaitingAnotherOrg, dueEvents, ofOrg, pendingEvents } from '../../store/outbox';
import type { DomainEvent } from '../types';

/**
 * Le bac à sable de simulation.
 *
 * L'étanchéité vraie est tenue par PostgreSQL : RLS refuse à un compte de
 * simulation d'écrire dans la maison réelle, et la cascade sur
 * `organizations` efface tout d'un prédicat. Ces deux propriétés-là se
 * vérifient en base, pas ici (`scripts/simulation-purge.sql`).
 *
 * Ce que ces tests tiennent, c'est le seul endroit où le client pouvait
 * encore mélanger les deux maisons : la file d'attente. Un appareil qui a
 * servi à la simulation puis à la vraie journée porte les deux dans sa file,
 * et c'est la session ouverte qui décide de la destination. Sans filtre, une
 * vente de simulation partirait dans le chiffre d'affaires réel — ce que tout
 * le dispositif existe pour empêcher.
 */

const REAL_ORG = '11111111-1111-1111-1111-111111111111';

const event = (over: Partial<DomainEvent>): DomainEvent => ({
  id: 'e', organizationId: REAL_ORG, siteId: 's', eventType: 'SALE_COMPLETED',
  entityType: 'Sale', entityId: 'sale', actorUserId: 'u', deviceId: 'd',
  payload: {}, createdAtLocal: '2026-08-17T09:00:00Z', createdAtServer: null,
  syncStatus: 'QUEUED', attempts: 0, ...over,
});

describe("le bac à sable se reconnaît à son organisation", () => {
  it('ne confond pas la maison réelle avec la simulation', () => {
    expect(isSimulation(SIMULATION_ORG_ID)).toBe(true);
    expect(isSimulation(REAL_ORG)).toBe(false);
  });

  it("ne prend pas l'absence d'organisation pour une simulation", () => {
    expect(isSimulation(null)).toBe(false);
    expect(isSimulation(undefined)).toBe(false);
  });
});

describe("la file n'envoie jamais un fait à la mauvaise maison", () => {
  const file = [
    event({ id: 'reel-1' }),
    event({ id: 'simu-1', organizationId: SIMULATION_ORG_ID }),
    event({ id: 'simu-2', organizationId: SIMULATION_ORG_ID }),
  ];

  it("une vente de simulation ne part pas dans le chiffre d'affaires réel", () => {
    expect(ofOrg(file, REAL_ORG).map((e) => e.id)).toEqual(['reel-1']);
  });

  it("une vente réelle ne part pas dans la simulation", () => {
    expect(ofOrg(file, SIMULATION_ORG_ID).map((e) => e.id)).toEqual(['simu-1', 'simu-2']);
  });

  it("sans session ouverte, rien ne part", () => {
    expect(ofOrg(file, null)).toEqual([]);
  });

  /*
   * Le filtre écarte, il ne jette pas. Un fait daté attend son organisation :
   * il repartira à la prochaine session sous le compte qui l'a saisi. C'est la
   * différence entre « pas maintenant » et « perdu ».
   */
  it("ce qui est écarté reste dans la file, et se laisse compter", () => {
    expect(awaitingAnotherOrg(file, REAL_ORG)).toBe(2);
    expect(awaitingAnotherOrg(file, SIMULATION_ORG_ID)).toBe(1);
    expect(pendingEvents(file)).toHaveLength(3);
  });

  it("le compteur ignore ce qui est déjà parti ou définitivement refusé", () => {
    const soldee = [
      event({ id: 'simu-envoye', organizationId: SIMULATION_ORG_ID, syncStatus: 'SYNCED' }),
      event({ id: 'simu-refuse', organizationId: SIMULATION_ORG_ID, syncStatus: 'CONFLICT' }),
      event({ id: 'simu-attente', organizationId: SIMULATION_ORG_ID, syncStatus: 'FAILED' }),
    ];
    expect(awaitingAnotherOrg(soldee, REAL_ORG)).toBe(1);
  });

  /*
   * `dueEvents` est ce que la boucle de synchronisation envoie réellement.
   * Le filtre doit tenir jusque-là : le vérifier sur `ofOrg` seul laisserait
   * passer un branchement oublié dans le store.
   */
  it("la boucle d'envoi ne voit que la maison ouverte", () => {
    const envoyables = dueEvents(ofOrg(file, REAL_ORG), new Map());
    expect(envoyables.map((e) => e.id)).toEqual(['reel-1']);
  });
});
