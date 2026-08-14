import { describe, expect, it } from 'vitest';
import { FEATURES } from '../../features/registry';

/**
 * Aucune navigation ne doit mener au `*`.
 *
 * Quand les écrans ont déménagé de `src/screens/<rôle>/` vers `src/features/`,
 * les routes ont été renommées mais les `navigate()` internes sont restés sur
 * les anciens chemins. Onze cibles pointaient dans le vide : react-router
 * retombait silencieusement sur `<Navigate to="/" />`, et l'utilisateur se
 * retrouvait à l'accueil au lieu de son reçu. Rien ne plantait, donc rien ne
 * le signalait — d'où ce test.
 */

/* Le source est lu par le bundler, pas par `node:fs` : l'application est une
   cible navigateur, y faire entrer les types Node pour un test serait payer
   cher une commodité. */
const SOURCES = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const declaredRoutes = (() => {
  const app = Object.entries(SOURCES).find(([path]) => path.endsWith('/App.tsx'))?.[1] ?? '';
  return [...app.matchAll(/<Route path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== '*');
})();

/** Une route déclarée peut porter un paramètre (`/vente/:id`). */
function isDeclared(target: string): boolean {
  return declaredRoutes.some((route) => {
    if (route === target) return true;
    if (!route.includes(':')) return false;
    return new RegExp(`^${route.replace(/:[A-Za-z]+/g, '[^/]+')}$`).test(target);
  });
}

describe('routage', () => {
  it('déclare au moins une route par feature', () => {
    expect(declaredRoutes.length).toBeGreaterThan(20);
  });

  it("ne laisse aucune cible de navigation sans route", () => {
    const orphans: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file.includes('__tests__')) continue;
      const targets = [
        ...[...text.matchAll(/navigate\(\s*['"](\/[^'"]*)['"]/g)].map((m) => m[1]),
        ...[...text.matchAll(/\bto=\{?\s*['"](\/[^'"]*)['"]/g)].map((m) => m[1]),
        ...[...text.matchAll(/\b(?:to|actionTarget):\s*['"](\/[^'"]*)['"]/g)].map((m) => m[1]),
      ];
      for (const target of targets) {
        if (!isDeclared(target)) orphans.push(`${file} → ${target}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('donne une destination déclarée à chaque opération du registre', () => {
    const orphans = FEATURES.flatMap((feature) => [
      ...(isDeclared(feature.home) ? [] : [`${feature.id} → ${feature.home}`]),
      ...feature.operations
        .filter((operation) => operation.to && !isDeclared(operation.to))
        .map((operation) => `${operation.id} → ${operation.to}`),
    ]);
    expect(orphans).toEqual([]);
  });
});

/**
 * Un onglet doit toujours mener quelque part.
 *
 * `homeRequires` décide de la VISIBILITÉ d'une feature ; la garde de sa route
 * décide de son ACCÈS. Quand les deux divergent, l'application affiche une
 * destination qu'elle refuse ensuite d'ouvrir : Maty, responsable finance,
 * voyait l'onglet « Vendre » parce qu'elle peut lire les ventes, et tombait
 * sur un comptoir interdit. Quatre features avaient ce défaut.
 *
 * La règle : toute capacité qui rend une feature visible doit suffire à ouvrir
 * son accueil.
 */
const guardsByRoute = (() => {
  const app = Object.entries(SOURCES).find(([path]) => path.endsWith('/App.tsx'))?.[1] ?? '';
  const out = new Map<string, string[]>();
  for (const m of app.matchAll(/<Route path="([^"]+)" element={guard\(\[([^\]]*)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/'([A-Z_]+)'/g)].map((c) => c[1]));
  }
  return out;
})();

describe('cohérence navigation / gardes', () => {
  it('garde au moins une route gardée par feature', () => {
    expect(guardsByRoute.size).toBeGreaterThan(15);
  });

  it("n'affiche jamais une feature dont l'accueil serait refusé", () => {
    const fautes: string[] = [];

    for (const feature of FEATURES) {
      const guard = guardsByRoute.get(feature.home);
      if (!guard) continue; // accueil non gardé : rien à vérifier
      for (const capability of feature.homeRequires) {
        if (!guard.includes(capability)) {
          fautes.push(
            `${feature.id} : « ${capability} » fait apparaître l'onglet mais n'ouvre pas ${feature.home} (garde : ${guard.join(', ')})`,
          );
        }
      }
    }

    expect(fautes).toEqual([]);
  });
});
