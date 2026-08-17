import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Les référentiels survivent-ils au rechargement, et les écrans savent-ils
 * qu'ils peuvent être vides ?
 *
 * Deux pannes distinctes sont encodées ici. L'écran de préparation nommait sa
 * recette en dur et affirmait qu'elle existait : sur un catalogue vide — l'état
 * d'une installation neuve — il s'arrêtait à l'ouverture. Et le cache des
 * référentiels écrivait les versions de recette sans leur en-tête, si bien
 * qu'une recette enregistrée disparaissait au rechargement suivant.
 */

/* Le source est lu par le bundler, pas par `node:fs` — même raison que
   `routes.test.ts` et `resilience.test.ts` : la cible est le navigateur. */
const SOURCES = import.meta.glob('../../features/**/*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

describe('un écran ne suppose jamais qu\'un référentiel est peuplé', () => {
  /* Un glob qui ne ramène rien ferait passer les deux tests suivants sans rien
     vérifier : on s'assure d'abord qu'il y a bien des écrans à lire. */
  it('lit réellement les écrans', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
  });

  /*
   * `RECIPE_VERSIONS.find(...)!` compile sans broncher et rend `undefined` dès
   * que la liste est vide ou porte de vrais identifiants. Le `!` ne protège
   * rien : il empêche seulement TypeScript de le dire.
   */
  it('n\'affirme pas non-nul le résultat d\'un find sur un référentiel', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const line of source.split('\n')) {
        if (/\b(RECIPES|RECIPE_VERSIONS|LOCATIONS|SUPPLIERS|USERS)\b[\s\S]{0,80}?\.find\([^)]*\)!/.test(line)) {
          offenders.push(`${path}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /* Les identifiants de démonstration ne doivent plus décider du produit
     fabriqué : la recette porte déjà son article et son nom. */
  it('ne fait plus dépendre la production d\'identifiants de démonstration', () => {
    const production = Object.entries(SOURCES)
      .filter(([path]) => path.includes('/production/'))
      .map(([, source]) => source)
      .join('\n');
    expect(production).not.toMatch(/'rc-vanilla'|'rc-caramel'|'rv-vanilla-2'|'it-caramel'/);
  });
});

describe('le cache des référentiels rend ce qu\'on lui a confié', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.resetModules();
  });

  it('réécrit les recettes au rechargement, pas seulement leurs versions', async () => {
    const first = await import('../../store/referentials');
    const recipe = {
      id: 'rec-1', itemId: 'it-cafe', name: 'Café Touba Moyen', currentVersionId: 'ver-1',
    };
    const version = {
      id: 'ver-1', recipeId: 'rec-1', version: 1, frozen: false,
      ingredients: [{ itemId: 'it-cacao', quantity: 0.05, unit: 'kg' as const }],
    };

    first.applyReferentials({
      site: null, locations: [], suppliers: [], users: [], items: [],
      recipes: [recipe], recipeVersions: [version],
    });
    expect(first.RECIPES.map((r) => r.name)).toEqual(['Café Touba Moyen']);

    /* Le rechargement : le module est relu, et ne dispose plus que du cache. */
    vi.resetModules();
    const reloaded = await import('../../store/referentials');
    expect(reloaded.RECIPES.map((r) => r.name)).toEqual(['Café Touba Moyen']);
    expect(reloaded.RECIPE_VERSIONS.map((v) => v.id)).toEqual(['ver-1']);
  });
});
