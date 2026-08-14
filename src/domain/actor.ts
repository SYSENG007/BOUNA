/**
 * Qui a fait quoi, quand, depuis où, et sous quelle autorisation.
 *
 * Le champ `under` est ce qui distingue ce tampon d'une simple colonne
 * `user_id` : quand un vendeur réceptionne une livraison, le journal dit sous
 * quelle capacité il l'a fait. Une contestation trois semaines plus tard se
 * résout en une ligne, sans avoir à reconstituer qui avait quel droit ce jour-là.
 */

import type { UUID } from './types';
import type { Capability, Post } from './capabilities';

export interface Actor {
  userId: UUID;
  /**
   * Le nom au moment du fait. Dénormalisé exprès : l'historique doit rester
   * lisible dans deux ans, même si la personne a quitté l'équipe, et même hors
   * ligne où la table des profils n'est pas là — sans compter que RLS masque
   * les profils aux yeux d'un vendeur.
   */
  userName: string;
  /** Le poste au moment du fait, pas le poste actuel. */
  post: Post;
  /** Sous quelle capacité l'opération a été exécutée. */
  under: Capability;
  deviceId: string;
  at: string;
}

/** Tout fait métier porte son auteur. */
export type Traced<T> = T & { actor: Actor };

export function makeActor(input: {
  userId: UUID;
  userName: string;
  post: Post;
  under: Capability;
  deviceId: string;
  at?: string;
}): Actor {
  return {
    userId: input.userId,
    userName: input.userName,
    post: input.post,
    under: input.under,
    deviceId: input.deviceId,
    at: input.at ?? new Date().toISOString(),
  };
}

/** Prénom seul : au comptoir on s'appelle par son prénom. */
export function actorFirstName(actor: Actor): string {
  return actor.userName.split(' ')[0] || actor.userName;
}

export function actorTime(actor: Actor): string {
  const d = new Date(actor.at);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function actorDate(actor: Actor): string {
  const d = new Date(actor.at);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Le tampon d'un fait dont on ne connaît pas l'auteur — données antérieures à
 * la traçabilité, ou import. On ne fabrique pas un auteur plausible : on dit
 * qu'on ne sait pas.
 */
export const UNKNOWN_ACTOR: Actor = {
  userId: 'unknown',
  userName: 'Auteur inconnu',
  post: 'SELLER',
  under: 'SELL',
  deviceId: 'unknown',
  at: '',
};

export function isKnownActor(actor: Actor | undefined | null): actor is Actor {
  return !!actor && actor.userId !== 'unknown';
}
