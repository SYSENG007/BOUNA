/**
 * Écarts et recouvrements.
 *
 * Un écart est la différence entre ce que le système déduit (le théorique) et
 * ce que quelqu'un a déclaré (le compté, l'encaissé). Il naît de trois endroits :
 * la caisse, le stock, le rendement d'une préparation.
 *
 * Jusqu'ici chacun vivait dans son écran et aucun ne se soldait. Un écart
 * constaté n'est pourtant pas une information : c'est une question ouverte.
 * Le recouvrement est le fait daté qui y répond — un motif, une imputation, un
 * auteur. Tant qu'il manque, l'écart remonte au tableau de bord.
 *
 * Logique pure : ni React, ni réseau, ni horloge implicite.
 */

import type { UUID } from './types';
import type { Actor } from './actor';

export type VarianceSource = 'CASH' | 'STOCK' | 'YIELD';

export const VARIANCE_SOURCE_LABEL: Record<VarianceSource, string> = {
  CASH: 'Caisse',
  STOCK: 'Stock',
  YIELD: 'Rendement',
};

/**
 * Comment un écart se solde. Les cinq motifs ne sont pas équivalents : trois
 * coûtent de l'argent (perte, vol, offert), un n'en coûte pas (erreur de
 * saisie), un le constate sans l'expliquer (ajustement).
 */
export type Resolution = 'PERTE' | 'ERREUR_SAISIE' | 'OFFERT' | 'VOL' | 'AJUSTEMENT';

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  PERTE: 'Perte constatée',
  ERREUR_SAISIE: 'Erreur de saisie',
  OFFERT: 'Offert ou consommé sur place',
  VOL: 'Vol',
  AJUSTEMENT: 'Ajustement sans explication',
};

/** Un motif qui reconnaît une sortie d'argent réelle. */
export const COSTLY_RESOLUTIONS: readonly Resolution[] = ['PERTE', 'VOL', 'OFFERT'];

export function isCostly(resolution: Resolution): boolean {
  return COSTLY_RESOLUTIONS.includes(resolution);
}

export interface Variance {
  id: UUID;
  source: VarianceSource;
  /** La session de caisse, le comptage ou le batch qui l'a fait apparaître. */
  reference: UUID;
  /** Libellé de ce sur quoi porte l'écart — article, shift, recette. */
  subject: string;
  /** Ce que le système déduit. */
  theoretical: number;
  /** Ce que quelqu'un a déclaré. */
  declared: number;
  /** declared − theoretical. Négatif : il manque. */
  delta: number;
  /** Valorisation de l'écart en FCFA. Toujours positive : c'est un montant en jeu. */
  amount: number;
  /** Qui a constaté. */
  actor: Actor;
  resolution: Resolution | null;
  resolutionNote?: string;
  /** Qui a soldé. Null tant que l'écart est ouvert. */
  resolver: Actor | null;
  createdAt: string;
}

export function isOpen(v: Variance): boolean {
  return v.resolution === null;
}

export function openVariances(variances: Variance[]): Variance[] {
  return variances.filter(isOpen).sort((a, b) => b.amount - a.amount);
}

/**
 * Ce qu'il reste à expliquer, en FCFA. C'est le chiffre du bandeau : tant
 * qu'il n'est pas à zéro, quelqu'un doit trancher.
 */
export function unresolvedAmount(variances: Variance[]): number {
  return openVariances(variances).reduce((s, v) => s + v.amount, 0);
}

/**
 * Ce que les écarts soldés ont réellement coûté sur la période.
 * Une erreur de saisie ne coûte rien — la corriger n'est pas une perte.
 */
export function recoveredCost(variances: Variance[]): number {
  return variances
    .filter((v) => v.resolution !== null && isCostly(v.resolution))
    .reduce((s, v) => s + v.amount, 0);
}

export interface VarianceBreakdown {
  source: VarianceSource;
  open: number;
  openAmount: number;
  resolved: number;
  costlyAmount: number;
}

export function breakdownBySource(variances: Variance[]): VarianceBreakdown[] {
  const sources: VarianceSource[] = ['CASH', 'STOCK', 'YIELD'];
  return sources.map((source) => {
    const rows = variances.filter((v) => v.source === source);
    const open = rows.filter(isOpen);
    return {
      source,
      open: open.length,
      openAmount: open.reduce((s, v) => s + v.amount, 0),
      resolved: rows.length - open.length,
      costlyAmount: recoveredCost(rows),
    };
  });
}

/**
 * Solde un écart. Retourne un nouvel objet — l'écart d'origine n'est pas muté,
 * et un écart déjà soldé ne se resolde pas : le premier motif fait foi.
 */
export function resolve(
  variance: Variance,
  resolution: Resolution,
  resolver: Actor,
  note?: string,
): Variance | null {
  if (variance.resolution !== null) return null;
  return { ...variance, resolution, resolutionNote: note, resolver };
}
