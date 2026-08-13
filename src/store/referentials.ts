import type { Recipe, RecipeVersion, Site, StockLocation, Supplier, User } from '../domain/types';
import {
  ITEMS as SEED_ITEMS, LOC as SEED_LOC, LOCATIONS as SEED_LOCATIONS, RECIPES as SEED_RECIPES,
  RECIPE_VERSIONS as SEED_RECIPE_VERSIONS, SITE as SEED_SITE, SUPPLIERS as SEED_SUPPLIERS,
  USERS as SEED_USERS,
} from '../domain/seed';

/**
 * Référentiels : emplacements, fournisseurs, site, recettes.
 *
 * Ces listes sont importées comme des constantes par une dizaine d'écrans
 * (`LOC.POS`, `LOCATIONS[1].id`, `SUPPLIERS[0].id`). Tant que ces écrans ne
 * lisent pas le store, on ne peut pas leur donner les identifiants réels par
 * un rendu : il faut réécrire les listes EN PLACE au moment de l'hydratation.
 *
 * Deux conséquences assumées, et deux garde-fous :
 *
 * 1. Un écran monté AVANT l'hydratation a pu figer un identifiant de
 *    démonstration dans un `useState`. Le provider remonte donc l'arbre quand
 *    la signature des référentiels change (voir `BunaStore`).
 * 2. Les écrans citent encore quelques identifiants de démonstration en dur
 *    (`'it-vanilla'`, `'rv-vanilla-2'`). On conserve une table d'alias
 *    « identifiant de démonstration → identifiant réel » que le store applique
 *    avant d'écrire quoi que ce soit. Cette table disparaîtra le jour où les
 *    écrans liront le catalogue au lieu de le nommer.
 */

/* ------------------------------------------------- Listes mutables exportées */

export const SITE: Site = { ...SEED_SITE };
export const LOC: Record<'CENTRAL' | 'KITCHEN' | 'FRIDGE' | 'POS', string> = { ...SEED_LOC };
export const LOCATIONS: StockLocation[] = SEED_LOCATIONS.map((l) => ({ ...l }));
export const SUPPLIERS: Supplier[] = SEED_SUPPLIERS.map((s) => ({ ...s }));
export const RECIPES: Recipe[] = SEED_RECIPES.map((r) => ({ ...r }));
export const RECIPE_VERSIONS: RecipeVersion[] = SEED_RECIPE_VERSIONS.map((v) => ({
  ...v,
  ingredients: v.ingredients.map((i) => ({ ...i })),
}));
export const USERS: User[] = SEED_USERS.map((u) => ({ ...u }));

/* ------------------------------------------------------------------ Alias */

let aliases = new Map<string, string>();

/** Identifiant réel s'il en existe un, sinon l'identifiant tel quel. */
export function resolveId<T extends string | undefined | null>(id: T): T {
  if (typeof id !== 'string') return id;
  return (aliases.get(id) ?? id) as T;
}

export function aliasEntries(): [string, string][] {
  return [...aliases.entries()];
}

/* --------------------------------------------------------- Rapprochement */

/** Rapproche par nom : « Café en grains » et « CAFE EN GRAINS » sont le même article. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface Named { id: string; name: string }

/** Noms du catalogue de démonstration — seul point commun avec la base. */
const SEED_ITEMS_NAMED: Named[] = SEED_ITEMS.map((i) => ({ id: i.id, name: i.name }));

/**
 * Table d'alias entre deux listes nommées.
 *
 * Le nom est le seul point commun entre le jeu de démonstration et la base :
 * les identifiants, eux, n'ont aucune raison de coïncider. Un nom présent des
 * deux côtés donne un alias ; un nom absent n'en donne pas — mieux vaut aucun
 * alias qu'un alias faux, qui rattacherait un mouvement au mauvais article.
 */
export function aliasByName(seed: readonly Named[], real: readonly Named[]): [string, string][] {
  const byName = new Map(real.map((r) => [normalizeName(r.name), r.id]));
  const out: [string, string][] = [];
  for (const s of seed) {
    const match = byName.get(normalizeName(s.name));
    if (match && match !== s.id) out.push([s.id, match]);
  }
  return out;
}

export interface Typed { id: string; type: string }

/** Les emplacements se rapprochent par TYPE : « le frigo » est un rôle, pas un nom. */
export function aliasByType(seed: readonly Typed[], real: readonly Typed[]): [string, string][] {
  const byType = new Map(real.map((r) => [r.type, r.id]));
  const out: [string, string][] = [];
  for (const s of seed) {
    const match = byType.get(s.type);
    if (match && match !== s.id) out.push([s.id, match]);
  }
  return out;
}

/* ----------------------------------------------------------- Application */

export interface ReferentialInput {
  site: Site | null;
  locations: StockLocation[];
  suppliers: Supplier[];
  users: User[];
  items: { id: string; name: string }[];
}

const CACHE_KEY = 'buna.referentials.v1';

interface CachedReferentials {
  site: Site;
  loc: typeof LOC;
  locations: StockLocation[];
  suppliers: Supplier[];
  users: User[];
  aliases: [string, string][];
  recipeVersions: RecipeVersion[];
}

function readCache(): CachedReferentials | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedReferentials) : null;
  } catch {
    return null;
  }
}

function writeCache(value: CachedReferentials): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Le cache n'est qu'une accélération : son absence ne casse rien.
  }
}

export function clearReferentialCache(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_KEY);
  } catch {
    // idem
  }
}

function replace<T>(target: T[], next: T[]): void {
  target.length = 0;
  target.push(...next);
}

function install(cached: CachedReferentials): void {
  Object.assign(SITE, cached.site);
  Object.assign(LOC, cached.loc);
  replace(LOCATIONS, cached.locations);
  replace(SUPPLIERS, cached.suppliers);
  replace(USERS, cached.users);
  replace(RECIPE_VERSIONS, cached.recipeVersions);
  aliases = new Map(cached.aliases);
}

/** Empreinte des référentiels : sert à savoir si l'arbre doit être remonté. */
export function signature(): string {
  return [SITE.id, LOC.CENTRAL, LOC.KITCHEN, LOC.FRIDGE, LOC.POS, SUPPLIERS[0]?.id ?? '', aliases.size]
    .join('|');
}

/**
 * Réécrit les référentiels avec les identifiants réels et renvoie la nouvelle
 * signature. Une liste vide côté serveur ne remplace JAMAIS une liste locale :
 * un écran qui fait `LOCATIONS[1].id` ou `RECIPE_VERSIONS.find(...)!` tomberait.
 */
export function applyReferentials(input: ReferentialInput): string {
  if (input.site) {
    aliases.set(SEED_SITE.id, input.site.id);
    Object.assign(SITE, input.site);
  }

  if (input.locations.length) {
    for (const [from, to] of aliasByType(SEED_LOCATIONS, input.locations)) aliases.set(from, to);
    replace(LOCATIONS, input.locations);
    for (const key of ['CENTRAL', 'KITCHEN', 'FRIDGE', 'POS'] as const) {
      const match = input.locations.find((l) => l.type === key);
      if (match) LOC[key] = match.id;
    }
  }

  if (input.suppliers.length) {
    for (const [from, to] of aliasByName(SEED_SUPPLIERS, input.suppliers)) aliases.set(from, to);
    replace(SUPPLIERS, input.suppliers);
  }

  if (input.users.length) {
    for (const [from, to] of aliasByName(SEED_USERS, input.users)) aliases.set(from, to);
    replace(USERS, input.users);
  }

  if (input.items.length) {
    for (const [from, to] of aliasByName(SEED_ITEMS_NAMED, input.items)) aliases.set(from, to);
  }

  // Les recettes ne sont pas encore en base (aucune ligne dans `recipes`).
  // On garde celles de démonstration mais on rebranche leurs ingrédients sur
  // les articles réels : sans ça, un batch consommerait des articles fantômes
  // et la consommation disparaîtrait du stock sans bruit.
  for (const version of RECIPE_VERSIONS) {
    for (const ingredient of version.ingredients) {
      ingredient.itemId = resolveId(ingredient.itemId);
    }
  }
  for (const recipe of RECIPES) recipe.itemId = resolveId(recipe.itemId);

  writeCache({
    site: { ...SITE },
    loc: { ...LOC },
    locations: LOCATIONS.map((l) => ({ ...l })),
    suppliers: SUPPLIERS.map((s) => ({ ...s })),
    users: USERS.map((u) => ({ ...u })),
    aliases: aliasEntries(),
    recipeVersions: RECIPE_VERSIONS.map((v) => ({ ...v, ingredients: v.ingredients.map((i) => ({ ...i })) })),
  });

  return signature();
}


/**
 * Reprise du cache AU CHARGEMENT DU MODULE, donc avant le premier rendu.
 * C'est ce qui fait qu'à partir du deuxième démarrage les écrans voient
 * directement les identifiants réels, sans remontage ni clignotement.
 */
const cached = readCache();
if (cached) install(cached);
