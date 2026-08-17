import type { Item, ProductionBatch, StockMovement, Unit, UUID } from './types';
import { canConvert, convert } from './units';

/**
 * Ce que les matières permettent encore de produire.
 *
 * Le calcul vivait dans l'écran Production, qui l'affichait ; l'écran de
 * déclaration, lui, ne le connaissait pas et laissait enregistrer un batch de
 * vingt-deux unités avec de quoi en faire zéro. Le stock devenait une fiction :
 * du lait à −15 L, un « Rupture » sur un article qu'on venait de consommer
 * deux fois. Les deux écrans lisent désormais la même fonction.
 *
 * On prend le maillon le plus faible de la recette — c'est lui qui casse le
 * service. Et on compare dans l'unité de l'ARTICLE : une recette en millilitres
 * face à un stock en litres, comparés bruts, donnent n'importe quoi.
 */
export interface RecipeIngredientLike {
  itemId: UUID;
  quantity: number;
  unit: Unit;
}

export interface Feasibility {
  /** Unités entières réalisables. Zéro si un ingrédient manque. */
  units: number;
  /** L'ingrédient qui limite, celui qu'il faut racheter en premier. */
  limitingItemId?: UUID;
  limitingName: string;
  /** Aucune recette exploitable : on ne sait pas, ce n'est pas « zéro ». */
  unknown: boolean;
}

export function feasibleUnits(
  ingredients: readonly RecipeIngredientLike[],
  itemOf: (id: UUID) => Item | undefined,
  availableOf: (id: UUID) => number,
): Feasibility {
  let min = Infinity;
  let limitingItemId: UUID | undefined;
  let limitingName = '—';
  let seen = 0;

  for (const ing of ingredients) {
    const item = itemOf(ing.itemId);
    /* Une unité qu'on ne sait pas traduire n'est pas une contrainte qu'on peut
       évaluer : on l'ignore comme un ingrédient inconnu, plutôt que d'arrêter
       l'écran de préparation sur une exception. */
    if (!item || !canConvert(ing.unit, item.unit)) continue;
    seen += 1;
    const perUnit = convert(ing.quantity, ing.unit, item.unit);
    if (perUnit <= 0) continue;
    const possible = availableOf(ing.itemId) / perUnit;
    if (possible < min) {
      min = possible;
      limitingItemId = item.id;
      limitingName = item.name;
    }
  }

  if (seen === 0 || min === Infinity) {
    return { units: 0, limitingName: '—', unknown: true };
  }
  return { units: Math.max(0, Math.floor(min)), limitingItemId, limitingName, unknown: false };
}

/**
 * De combien le stock passerait-il en négatif si on déclarait `quantity` ?
 *
 * On ne bloque pas la déclaration : le préparateur a réellement fabriqué ce
 * qu'il déclare, et lui refuser sa saisie ne ferait qu'éloigner l'application
 * du terrain. Mais on lui montre la conséquence avant qu'il valide.
 */
export interface Shortfall {
  itemId: UUID;
  name: string;
  missing: number;
  unit: Unit;
  /** Part du besoin qui n'est pas couverte, de 0 à 1. */
  ratio: number;
}

export function shortfallFor(
  ingredients: readonly RecipeIngredientLike[],
  itemOf: (id: UUID) => Item | undefined,
  availableOf: (id: UUID) => number,
  quantity: number,
): Shortfall[] {
  const out: Shortfall[] = [];
  for (const ing of ingredients) {
    const item = itemOf(ing.itemId);
    if (!item || !canConvert(ing.unit, item.unit)) continue;
    const needed = convert(ing.quantity, ing.unit, item.unit) * quantity;
    const missing = needed - availableOf(ing.itemId);
    if (missing > 0.0001) {
      out.push({
        itemId: item.id,
        name: item.name,
        missing: Math.round(missing * 100) / 100,
        unit: item.unit,
        ratio: needed > 0 ? missing / needed : 1,
      });
    }
  }
  /* Trier sur la quantité manquante reviendrait à comparer 22 gobelets à
     3,96 litres de lait. La part non couverte, elle, se compare. */
  return out.sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name));
}


/* ------------------------------------------------ Ce qu'un lot a consommé */

/** Une sortie de stock : un article, une quantité TOTALE pour le lot, son unité. */
export interface ConsumedLine {
  itemId: UUID;
  quantity: number;
  unit: Unit;
}

/**
 * Ce qu'une préparation a consommé — le constat d'abord, la recette ensuite.
 *
 * Deux sources, jamais du même ordre de grandeur. Ce que quelqu'un déclare
 * avoir sorti est un TOTAL pour le lot (« j'ai pris 2 L de lait ») ; une
 * recette est un dosage PAR UNITÉ, qu'il faut multiplier par la quantité
 * produite. Les confondre sortirait deux litres par café, ou un demi-café
 * de lait pour quarante cafés — dans les deux cas le stock devient une
 * fiction, et personne ne saura d'où elle vient.
 *
 * Le constat l'emporte quand il existe : c'est ce qui est réellement sorti de
 * l'étagère. La recette ne dit que ce qui aurait dû sortir — et c'est
 * précisément l'écart entre les deux que §66 cherche à mesurer. Tant que la
 * consommation était systématiquement recopiée de la recette, cet écart valait
 * zéro par construction.
 *
 * Aucune des deux sources n'est obligatoire : un lot déclaré sans recette et
 * sans constat produit du stock sans en consommer. C'est incomplet, ce n'est
 * pas faux — et c'est le comptage du soir qui le rattrape.
 *
 * `complete_batch` applique la même règle côté serveur. Elle doit rester
 * identique des deux côtés, sinon les deux projections divergent sur le
 * même fait.
 */
export function consumedBy(
  produced: number,
  declared: readonly ConsumedLine[] | undefined,
  ingredients: readonly RecipeIngredientLike[] | undefined,
): ConsumedLine[] {
  const stated = (declared ?? []).filter((line) => line.quantity > 0);
  if (stated.length > 0) {
    return stated.map((line) => ({ itemId: line.itemId, quantity: line.quantity, unit: line.unit }));
  }
  return (ingredients ?? [])
    .filter((ing) => ing.quantity > 0)
    .map((ing) => ({ itemId: ing.itemId, quantity: ing.quantity * produced, unit: ing.unit }));
}

/* ------------------------------------------------- §66 Théorique vs réel */

/**
 * Ce que les recettes disaient qu'on consommerait, face à ce qui est sorti.
 *
 * L'écran Stock lisait cet écart sur un article nommé en dur — `it-lait` — et
 * sur une dose supposée de 150 mL par produit vendu, quelle que soit la boisson.
 * Sur un catalogue réel l'article n'existait pas : le « réel » valait zéro, le
 * « théorique » se calculait sur une recette imaginaire, et l'écart affiché ne
 * décrivait rien. Un écart inventé est pire qu'un écart absent — on l'explique,
 * on ouvre un inventaire, on cherche une perte qui n'a pas eu lieu.
 *
 * Le théorique se déduit donc des recettes réellement enregistrées : pour
 * chaque produit vendu, ce que sa recette prévoit, ingrédient par ingrédient.
 * Le réel vient des mouvements `PRODUCTION_CONSUMPTION`. Les deux sont ramenés
 * à l'unité de l'article, jamais comparés bruts.
 */
export interface ConsumptionVariance {
  itemId: UUID;
  name: string;
  unit: Unit;
  /** Déduit des recettes, pour ce qui a été vendu. */
  theoretical: number;
  /** Sorti du stock par la production. */
  actual: number;
  /** `actual − theoretical`. Positif : on a consommé plus que la recette. */
  delta: number;
  /** Unités vendues dont la recette appelle cet ingrédient. */
  soldUnits: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function consumptionVariance(
  soldByItem: ReadonlyMap<UUID, number>,
  movements: readonly StockMovement[],
  ingredientsOf: (finishedItemId: UUID) => readonly RecipeIngredientLike[] | undefined,
  itemOf: (id: UUID) => Item | undefined,
): ConsumptionVariance[] {
  const theoretical = new Map<UUID, number>();
  const sold = new Map<UUID, number>();

  for (const [finishedId, quantity] of soldByItem) {
    const ingredients = ingredientsOf(finishedId);
    if (!ingredients?.length || quantity <= 0) continue;
    for (const ing of ingredients) {
      const item = itemOf(ing.itemId);
      if (!item || !canConvert(ing.unit, item.unit)) continue;
      const need = convert(ing.quantity, ing.unit, item.unit) * quantity;
      theoretical.set(ing.itemId, (theoretical.get(ing.itemId) ?? 0) + need);
      sold.set(ing.itemId, (sold.get(ing.itemId) ?? 0) + quantity);
    }
  }

  const actual = new Map<UUID, number>();
  for (const m of movements) {
    if (m.movementType !== 'PRODUCTION_CONSUMPTION') continue;
    const item = itemOf(m.itemId);
    if (!item || !canConvert(m.unit, item.unit)) continue;
    const out = Math.abs(convert(m.quantity, m.unit, item.unit));
    actual.set(m.itemId, (actual.get(m.itemId) ?? 0) + out);
  }

  const rows: ConsumptionVariance[] = [];
  for (const itemId of new Set([...theoretical.keys(), ...actual.keys()])) {
    const item = itemOf(itemId);
    if (!item) continue;
    const t = round(theoretical.get(itemId) ?? 0);
    const a = round(actual.get(itemId) ?? 0);
    /* Ni prévu ni sorti : il n'y a rien à raconter. */
    if (t === 0 && a === 0) continue;
    rows.push({
      itemId, name: item.name, unit: item.unit,
      theoretical: t, actual: a, delta: round(a - t),
      soldUnits: sold.get(itemId) ?? 0,
    });
  }

  /*
   * L'écart le plus significatif d'abord — en proportion, pas en valeur brute.
   *
   * Comparer les écarts absolus reviendrait à mettre « 10 gobelets » et
   * « 0,3 kg de café » sur la même échelle : le classement suivrait l'unité
   * plutôt que la gravité. Rapporté au théorique, l'écart redevient
   * comparable d'un article à l'autre. Une sortie sans recette pour la
   * justifier passe devant : c'est le cas le moins explicable.
   */
  const severity = (row: ConsumptionVariance) =>
    row.theoretical > 0 ? Math.abs(row.delta) / row.theoretical : Infinity;

  return rows.sort((x, y) => severity(y) - severity(x));
}


/* ------------------------------------------ La recette que le terrain écrit */

/** Une dose observée, ramenée à une unité produite. */
export interface ObservedDose {
  itemId: UUID;
  /** Moyenne par unité produite, dans l'unité où la sortie a été notée. */
  quantity: number;
  unit: Unit;
  /** Nombre de lots où cet article a été noté. */
  batches: number;
  /**
   * Dispersion entre lots, de 0 à 1 — l'écart-type rapporté à la moyenne.
   *
   * Zéro : la même dose à chaque fois, on peut la figer les yeux fermés.
   * Élevé : les lots ne se ressemblent pas, et la moyenne cache autant qu'elle
   * montre. On l'affiche plutôt que de la taire : une recette proposée sur des
   * mesures qui divergent doit être relue, pas acceptée.
   */
  spread: number;
}

export interface ObservedRecipe {
  itemId: UUID;
  /** Lots exploitables — ceux dont la sortie a été notée. */
  batches: number;
  /** Unités produites sur ces lots. */
  produced: number;
  doses: ObservedDose[];
}

/**
 * La recette que les lots ont déjà écrite, sans que personne la rédige.
 *
 * C'est la rampe entre les deux régimes. Le suivi simple n'a pas besoin de
 * recette — mais chaque fois qu'un préparateur note ce qu'il a sorti, il en
 * décrit une sans le savoir. Au bout de quelques lots, la moyenne devient une
 * proposition sérieuse : « vos 12 derniers Café Touba ont consommé 45 mL de
 * lait par unité — l'enregistrer comme recette ? »
 *
 * Sans cela, le suivi simple serait un cul-de-sac confortable : plus facile à
 * tenir, et sans chemin vers la précision autre qu'une soirée de saisie.
 *
 * Un lot SANS consommation notée est ignoré, pas compté pour zéro. C'est le
 * piège de ce calcul : inclure ces lots ferait une moyenne sur des zéros et
 * diviserait chaque dose par le nombre de lots muets — une recette deux fois
 * trop légère, proposée avec l'aplomb d'une mesure.
 */
export function observedRecipe(
  finishedItemId: UUID,
  batches: readonly ProductionBatch[],
  movements: readonly StockMovement[],
  minimumBatches = 3,
): ObservedRecipe | null {
  const mine = batches.filter((b) => b.itemId === finishedItemId && b.producedQuantity > 0);
  if (!mine.length) return null;

  /* Par lot : ce qui est sorti, ramené à une unité produite. */
  const perBatch = new Map<UUID, Map<string, { quantity: number; unit: Unit; itemId: UUID }>>();
  for (const m of movements) {
    if (m.movementType !== 'PRODUCTION_CONSUMPTION') continue;
    const batch = mine.find((b) => b.id === m.referenceId);
    if (!batch) continue;
    const key = `${m.itemId}|${m.unit}`;
    const lines = perBatch.get(batch.id) ?? new Map();
    const seen = lines.get(key);
    lines.set(key, {
      itemId: m.itemId,
      unit: m.unit,
      quantity: (seen?.quantity ?? 0) + Math.abs(m.quantity) / batch.producedQuantity,
    });
    perBatch.set(batch.id, lines);
  }

  if (perBatch.size < minimumBatches) return null;

  /* Puis la moyenne entre lots, article par article. */
  const samples = new Map<string, { itemId: UUID; unit: Unit; values: number[] }>();
  for (const lines of perBatch.values()) {
    for (const [key, line] of lines) {
      const acc = samples.get(key) ?? { itemId: line.itemId, unit: line.unit, values: [] };
      acc.values.push(line.quantity);
      samples.set(key, acc);
    }
  }

  const doses: ObservedDose[] = [];
  for (const { itemId, unit, values } of samples.values()) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean <= 0) continue;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    doses.push({
      itemId,
      unit,
      quantity: Math.round(mean * 10_000) / 10_000,
      batches: values.length,
      spread: Math.round((Math.sqrt(variance) / mean) * 100) / 100,
    });
  }

  if (!doses.length) return null;

  const exploited = mine.filter((b) => perBatch.has(b.id));
  return {
    itemId: finishedItemId,
    batches: perBatch.size,
    produced: exploited.reduce((s, b) => s + b.producedQuantity, 0),
    /* Le plus dispersé en tête : c'est celui qu'il faut relire avant de figer. */
    doses: doses.sort((a, b) => b.spread - a.spread),
  };
}
