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
