import type { Item, Sale, StockMovement, UUID } from './types';
import type { Purchase } from './types';
import { materialBalance, productFlows, type PeriodWindow } from './period-balance';
import type { OperatingMode } from './operating-mode';

/**
 * Les incohérences de la journée, dites en français.
 *
 * Le suivi simple achète sa souplesse avec une contrepartie : on ne bloque plus
 * rien au moment du geste. Vendre au-delà de ce qu'on a déclaré préparé passe,
 * un stock peut finir négatif, une marge peut se calculer sur un coût qu'on
 * n'a jamais renseigné. Rien de tout cela n'est une erreur en soi — c'est
 * simplement une déclaration incomplète, et il faut le dire AVANT de signer la
 * journée, pas trois semaines plus tard devant un chiffre qu'on ne s'explique
 * plus.
 *
 * Chaque constat porte donc trois choses, et pas une de moins :
 * ce qu'on observe, ce que ça fausse, et ce qu'on peut y faire. Un avertissement
 * qui ne dit pas la conséquence se lit comme une pinaillerie, et on apprend à le
 * fermer sans lire.
 *
 * Ce module ne bloque RIEN. Il ne rend pas la clôture impossible : il la rend
 * lucide. Logique pure — ni React, ni réseau, ni horloge implicite.
 */

export type CoherenceSeverity = 'INFO' | 'ATTENTION' | 'CRITIQUE';

export interface CoherenceFinding {
  id: string;
  severity: CoherenceSeverity;
  /** Ce qu'on observe, chiffré. */
  statement: string;
  /** Ce que ça fausse dans les chiffres de la journée. */
  consequence: string;
  /** Ce qu'on peut faire — jamais « corrigez », toujours un geste nommé. */
  suggestion: string;
}

export interface CoherenceInput {
  items: readonly Item[];
  movements: readonly StockMovement[];
  sales: readonly Sale[];
  purchases: readonly Purchase[];
  window: PeriodWindow;
  mode: OperatingMode;
  siteId?: UUID;
}

const RANK: Record<CoherenceSeverity, number> = { CRITIQUE: 0, ATTENTION: 1, INFO: 2 };

/** Une part matière au-delà de laquelle on ne vend plus, on donne. */
const PART_MATIERE_HAUTE = 70;
/** En dessous, ce n'est pas une bonne marge : c'est un stock qu'on oublie de sortir. */
const PART_MATIERE_BASSE = 5;

export function coherenceFindings(input: CoherenceInput): CoherenceFinding[] {
  const { window: w, siteId } = input;
  const findings: CoherenceFinding[] = [];

  const flows = productFlows({ items: input.items, movements: input.movements, window: w, siteId });
  const balance = materialBalance({
    items: input.items, movements: input.movements, sales: input.sales,
    purchases: input.purchases, window: w, siteId,
  });

  /*
   * 1. On a vendu plus que ce qui existait.
   *
   * Le cas que le suivi simple rend possible, et le plus parlant : quarante
   * cafés vendus, trente déclarés préparés. Aucune des deux déclarations n'est
   * fausse en soi — c'est leur écart qui dit qu'il en manque une.
   */
  for (const f of flows) {
    const disponible = f.opening + f.produced + f.received + f.returned;
    const manquant = Math.round((f.sold - disponible) * 100) / 100;
    if (manquant <= 0.001) continue;
    findings.push({
      id: `vendu-sans-stock:${f.itemId}`,
      severity: 'CRITIQUE',
      statement:
        `${f.name} — ${f.sold} vendu${f.sold > 1 ? 's' : ''} alors que ${disponible} ` +
        `${disponible > 1 ? 'étaient disponibles' : 'était disponible'} : ${manquant} de plus que ce qui a été déclaré.`,
      consequence:
        "Ces ventes-là n'ont coûté aucune matière dans les comptes : la marge de la journée " +
        'est plus belle que la réalité.',
      suggestion:
        'Déclarez la préparation qui manque, ou corrigez le comptage. Les ventes, elles, sont justes — ' +
        "c'est ce qui les a rendues possibles qui n'a pas été dit.",
    });
  }

  /* 2. Un stock qui finit sous zéro : personne n'a de marchandise négative. */
  for (const f of flows) {
    if (f.closing >= -0.001) continue;
    findings.push({
      id: `stock-negatif:${f.itemId}`,
      severity: 'ATTENTION',
      statement: `${f.name} — le stock termine à ${f.closing}.`,
      consequence:
        "Un stock négatif n'existe pas sur une étagère : le point de départ de demain est faux, " +
        'et le besoin de production qui en découle aussi.',
      suggestion: 'Comptez cet article ce soir : le comptage remet le compteur sur ce qui existe vraiment.',
    });
  }

  /* 3. Vendu sans jamais avoir déclaré en préparer. */
  for (const f of flows) {
    if (f.sold <= 0 || f.produced > 0 || f.received > 0 || f.opening > 0) continue;
    findings.push({
      id: `jamais-prepare:${f.itemId}`,
      severity: 'ATTENTION',
      statement: `${f.name} — ${f.sold} vendu${f.sold > 1 ? 's' : ''}, aucune préparation déclarée.`,
      consequence:
        'Le produit se vend sans que rien ne sorte du stock : ni matière consommée, ni coût, ' +
        'donc une marge de 100 % sur cette ligne.',
      suggestion:
        'Déclarez ce que vous avez préparé, même approximativement — ou marquez le produit ' +
        '« monté devant le client » s\'il ne se prépare pas d\'avance.',
    });
  }

  const revenue = balance.revenue;

  /* 4. Du chiffre d'affaires sans aucune matière consommée. */
  if (revenue > 0 && balance.consumed <= 0) {
    findings.push({
      id: 'marge-sans-cout',
      severity: 'CRITIQUE',
      statement: `${revenue} FCFA de ventes, et aucune matière consommée sur la période.`,
      consequence:
        'La marge affichée est le chiffre d\'affaires entier. Ce n\'est pas un bénéfice, ' +
        "c'est une soustraction qui n'a rien trouvé à retrancher.",
      suggestion:
        'Enregistrez vos approvisionnements, puis comptez ce qui reste : le coût matière se déduit ' +
        'de ces deux chiffres, sans avoir besoin de recette.',
    });
  }

  /* 5. Une part matière qui ne ressemble à aucun métier. */
  if (revenue > 0 && balance.consumed > 0 && balance.materialSharePct !== null) {
    const part = balance.materialSharePct;
    if (part > PART_MATIERE_HAUTE) {
      findings.push({
        id: 'part-matiere-haute',
        severity: 'ATTENTION',
        statement: `La matière représente ${part} % du chiffre d'affaires.`,
        consequence:
          'À ce niveau, chaque vente laisse presque rien. Soit les prix sont trop bas, soit une ' +
          'partie du stock est sortie sans être vendue.',
        suggestion: 'Regardez les écarts de comptage ci-dessus avant de conclure que ce sont les prix.',
      });
    } else if (part < PART_MATIERE_BASSE) {
      findings.push({
        id: 'part-matiere-basse',
        severity: 'ATTENTION',
        statement: `La matière ne représente que ${part} % du chiffre d'affaires.`,
        consequence:
          "C'est trop beau pour un service : il est probable qu'une partie des sorties de stock " +
          "n'ait pas été déclarée, ou que le stock final soit surévalué.",
        suggestion: 'Vérifiez le comptage de fin de journée avant de vous fier à cette marge.',
      });
    }
  }

  /* 6. Un stock final que personne n'a compté. */
  if (balance.uncounted && revenue > 0) {
    findings.push({
      id: 'jamais-compte',
      severity: 'ATTENTION',
      statement: "Aucun comptage de matières sur la période.",
      consequence:
        'Le stock final est celui que le système déduit, pas celui de l\'étagère. Le coût matière ' +
        "et la marge qui en découle valent ce que valent les déclarations, sans témoin.",
      suggestion: 'Comptez au moins les matières qui coûtent cher : ce sont elles qui font le résultat.',
    });
  }

  /* 7. Des matières sans coût connu, qui allègent la facture en silence. */
  if (balance.incomplete) {
    findings.push({
      id: 'cout-inconnu',
      severity: 'INFO',
      statement: "Certaines matières en stock n'ont pas de coût connu.",
      consequence:
        'Elles comptent pour zéro dans la valeur du stock, ce qui gonfle le coût matière de la ' +
        'période et rabote la marge affichée.',
      suggestion: 'Renseignez leur coût au catalogue, ou passez une réception : elle le calcule toute seule.',
    });
  }

  return findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** Le constat le plus grave, pour un bandeau qui n'a la place que d'une ligne. */
export function worstSeverity(findings: readonly CoherenceFinding[]): CoherenceSeverity | null {
  if (!findings.length) return null;
  return findings.reduce<CoherenceSeverity>(
    (worst, f) => (RANK[f.severity] < RANK[worst] ? f.severity : worst),
    'INFO',
  );
}
