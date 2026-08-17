import type { Item, Sale, StockMovement, Unit, UUID } from './types';
import type { Purchase } from './types';
import { canConvert, convert } from './units';

/**
 * Le bilan d'une période — ce qu'on a mis dedans, ce qui en est sorti, ce
 * qu'il reste.
 *
 * C'est la mesure du suivi simple. Elle ne demande aucune recette : elle
 * compare des faits que l'établissement connaît déjà — ce qu'il a acheté, ce
 * qu'il a préparé, ce qu'il a vendu, ce qu'il a compté le soir.
 *
 * Deux lectures, et elles répondent à deux questions différentes.
 *
 * EN UNITÉS, par produit :
 *
 *     ouverture + préparé + reçu − vendu − jeté  =  attendu
 *     attendu + ce que le comptage a corrigé     =  ce qu'il reste vraiment
 *
 * L'écart n'accuse personne : il se nomme (offert, cassé, oublié de déclarer)
 * et se solde comme les autres écarts. Sans lui, un stock négatif au comptoir
 * resterait un mystère permanent.
 *
 * EN ARGENT, sur la période :
 *
 *     coût matière = stock initial + achats − stock final
 *
 * C'est la méthode que tient n'importe quel restaurant avant d'avoir ses
 * fiches techniques. Elle est juste au franc près sur la période et muette sur
 * le détail par produit — ce qui est exactement l'inverse de ce que la recette
 * sait faire, et exactement ce dont on dispose quand on ouvre.
 *
 * Rien ici ne lit un niveau de stock : tout se replie depuis les mouvements
 * (RULE-002). Logique pure — ni React, ni réseau, ni horloge implicite.
 */

/** Fenêtre `[from, to)` en instants ISO. Bornes exclusives à droite. */
export interface PeriodWindow {
  from: string;
  to: string;
}

const within = (at: string, w: PeriodWindow) => at >= w.from && at < w.to;

/**
 * Ce qu'un mouvement ajoute au stock de son article, ou rien.
 *
 * Même garde que la projection (`stock.ts`) et pour la même raison : une unité
 * qu'aucun facteur ne relie à celle de l'article ne s'invente pas. On l'écarte
 * du compte plutôt que de produire un chiffre faux — un bilan qui ment est
 * pire qu'un bilan incomplet, parce qu'on agit dessus.
 */
function contribution(m: StockMovement, item: Item): number {
  return canConvert(m.unit, item.unit) ? convert(m.quantity, m.unit, item.unit) : 0;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------ En unités, par produit */

export interface ProductFlow {
  itemId: UUID;
  name: string;
  unit: Unit;
  /** Ce qu'il en restait au début de la période. */
  opening: number;
  /** Déclaré préparé — les sorties de production. */
  produced: number;
  /** Entré par réception : les produits qu'on achète tout faits. */
  received: number;
  /** Vendu au comptoir. Positif. */
  sold: number;
  /** Déclaré perdu. Positif. */
  wasted: number;
  /** Rendu après annulation de vente. */
  returned: number;
  /** Ce qu'il devrait rester si rien ne s'était perdu en silence. */
  expected: number;
  /** Ce qu'il reste réellement — comptages compris. */
  closing: number;
  /**
   * `closing − expected` : ce que le comptage a dû corriger.
   *
   * Négatif, il manque de la marchandise — offerte, cassée, ou sortie sans
   * être déclarée. Zéro ne veut pas dire « tout va bien » : cela peut aussi
   * vouloir dire que personne n'a compté.
   */
  gap: number;
  /** Vrai si un comptage a eu lieu sur la période. Sinon `gap` ne prouve rien. */
  counted: boolean;
}

export interface FlowInput {
  items: readonly Item[];
  movements: readonly StockMovement[];
  window: PeriodWindow;
  /** Restreint à un site. Absent : tous sites confondus. */
  siteId?: UUID;
}

/**
 * Le mouvement des produits finis sur la période.
 *
 * Les transferts ne figurent pas : ils déplacent la marchandise d'un
 * emplacement à l'autre sans rien créer ni détruire, et se compensent dès
 * qu'on regarde le site entier. Les faire apparaître donnerait deux colonnes
 * qui s'annulent, ce qui n'apprend rien et fait douter du reste.
 */
export function productFlows(input: FlowInput): ProductFlow[] {
  const { window: w, siteId } = input;
  const scoped = input.movements.filter((m) => !siteId || m.siteId === siteId);

  const rows: ProductFlow[] = [];

  for (const item of input.items) {
    if (item.kind !== 'FINISHED' || item.archived) continue;

    let opening = 0;
    let closing = 0;
    let produced = 0;
    let received = 0;
    let sold = 0;
    let wasted = 0;
    let returned = 0;
    let adjusted = 0;
    let counted = false;

    for (const m of scoped) {
      if (m.itemId !== item.id) continue;
      const q = contribution(m, item);

      if (m.createdAt < w.from) {
        opening += q;
        closing += q;
        continue;
      }
      if (!within(m.createdAt, w)) continue;

      closing += q;
      switch (m.movementType) {
        case 'PRODUCTION_OUTPUT': produced += q; break;
        case 'PURCHASE_RECEIPT':
        case 'INITIAL': received += q; break;
        case 'SALE': sold += Math.abs(q); break;
        case 'WASTE': wasted += Math.abs(q); break;
        case 'RETURN': returned += q; break;
        case 'ADJUSTMENT': adjusted += q; counted = true; break;
        default: break;
      }
    }

    /* Rien n'a bougé et il n'y avait rien : le produit n'a pas d'histoire à
       raconter sur cette période. */
    const moved = produced || received || sold || wasted || returned || adjusted;
    if (!moved && opening === 0) continue;

    rows.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      opening: round(opening),
      produced: round(produced),
      received: round(received),
      sold: round(sold),
      wasted: round(wasted),
      returned: round(returned),
      /* L'attendu se déduit du réel moins ce que le comptage a corrigé : ainsi
         il ne peut jamais diverger de la projection, quelle que soit la
         diversité des mouvements. */
      expected: round(closing - adjusted),
      closing: round(closing),
      gap: round(adjusted),
      counted,
    });
  }

  /* Le manque le plus criant d'abord — c'est celui qui coûte. */
  return rows.sort((a, b) => a.gap - b.gap || b.sold - a.sold || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------- En argent, sur la période */

export interface MaterialBalance {
  /** Valeur des matières en stock au début, au coût moyen pondéré courant. */
  openingValue: number;
  /** Ce qui est entré : réceptions de la période, transport compris. */
  purchases: number;
  /** Valeur des matières en stock à la fin. */
  closingValue: number;
  /** `openingValue + purchases − closingValue`. Ce que la période a consommé. */
  consumed: number;
  /** Chiffre d'affaires encaissé sur la période. */
  revenue: number;
  /** `revenue − consumed`. */
  grossMargin: number;
  /** Part matière du chiffre d'affaires, en %. `null` sans chiffre d'affaires. */
  materialSharePct: number | null;
  /**
   * Vrai quand au moins une matière en stock n'a pas de coût connu.
   *
   * Le total est alors sous-évalué, donc le coût matière surévalué. On le dit :
   * un chiffre dont on tait l'approximation est lu comme exact.
   */
  incomplete: boolean;
  /** Vrai si aucun comptage n'a eu lieu sur la période — le stock final est théorique. */
  uncounted: boolean;
}

export interface BalanceInput {
  items: readonly Item[];
  movements: readonly StockMovement[];
  sales: readonly Sale[];
  purchases: readonly Purchase[];
  window: PeriodWindow;
  siteId?: UUID;
}

/**
 * Les articles qui composent le « coût matière ».
 *
 * Les produits finis en sont exclus, et c'est volontaire : ils sont FAITS de
 * ces matières. Les compter aussi reviendrait à payer deux fois le même lait —
 * une fois en tant que lait, une fois en tant que café. Un produit fini acheté
 * tout fait pour être revendu échappe donc à ce calcul ; c'est la limite
 * assumée de la méthode, et elle se voit dans la marge, pas dans le coût.
 */
const isMaterial = (item: Item) =>
  item.kind === 'RAW_MATERIAL' || item.kind === 'PACKAGING' || item.kind === 'INTERMEDIATE';

export function materialBalance(input: BalanceInput): MaterialBalance {
  const { window: w, siteId } = input;
  const materials = input.items.filter(isMaterial);
  const scoped = input.movements.filter((m) => !siteId || m.siteId === siteId);

  let openingValue = 0;
  let closingValue = 0;
  let incomplete = false;
  let uncounted = true;

  for (const item of materials) {
    let opening = 0;
    let closing = 0;
    for (const m of scoped) {
      if (m.itemId !== item.id) continue;
      if (m.createdAt >= w.to) continue;
      const q = contribution(m, item);
      closing += q;
      if (m.createdAt < w.from) opening += q;
      else if (m.movementType === 'ADJUSTMENT') uncounted = false;
    }
    if (opening === 0 && closing === 0) continue;
    if (item.weightedAvgCost === undefined) {
      incomplete = true;
      continue;
    }
    openingValue += opening * item.weightedAvgCost;
    closingValue += closing * item.weightedAvgCost;
  }

  /*
   * Les achats viennent des réceptions, pas des dépenses.
   *
   * Une réception écrit les deux : un achat (avec son détail par article) ET
   * une dépense de catégorie « Matières », qui est le même argent vu depuis la
   * caisse. Les additionner compterait chaque livraison deux fois. C'est le
   * seul piège de cette méthode, et il est silencieux — d'où le choix d'une
   * source unique, écrite ici une fois pour toutes.
   */
  const purchases = input.purchases
    .filter((p) => {
      const at = p.receivedAt ?? p.createdAt;
      return at != null && within(at, w);
    })
    .reduce((sum, p) => {
      const materialLines = p.lines.reduce((s, line) => {
        const item = input.items.find((i) => i.id === line.itemId);
        return item && isMaterial(item) ? s + line.quantity * line.actualUnitPrice : s;
      }, 0);
      return sum + materialLines + p.transportCost;
    }, 0);

  const revenue = input.sales
    .filter((s) => s.status === 'COMPLETED' && within(s.createdAt, w) && (!siteId || s.siteId === siteId))
    .reduce((sum, s) => sum + s.total, 0);

  const consumed = openingValue + purchases - closingValue;

  return {
    openingValue: Math.round(openingValue),
    purchases: Math.round(purchases),
    closingValue: Math.round(closingValue),
    consumed: Math.round(consumed),
    revenue: Math.round(revenue),
    grossMargin: Math.round(revenue - consumed),
    materialSharePct: revenue > 0 ? Math.round((consumed / revenue) * 100) : null,
    incomplete,
    uncounted,
  };
}
