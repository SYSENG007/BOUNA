import { describe, expect, it } from 'vitest';
import { ErrorBoundary, FAILURE_COPY, FAILURE_PROMISE } from '../../shell/ErrorBoundary';

/**
 * Une exception de rendu ne doit pas pouvoir arrêter le comptoir.
 *
 * Le vrai risque de régression n'est pas dans la limite d'erreur elle-même —
 * elle tient en trente lignes — mais dans son câblage : une limite décrochée
 * pendant un remaniement ne casse aucun test, ne lève aucun avertissement, et
 * ne se voit que le jour où un écran tombe en plein service. C'est donc le
 * câblage qu'on vérifie ici, à la source, comme pour les routes.
 *
 * Le rendu n'est volontairement pas monté : le projet teste en Node, sans DOM,
 * et faire entrer un navigateur simulé pour trois assertions coûterait plus
 * qu'il ne rapporte.
 */

/* Le source est lu par le bundler, pas par `node:fs` — même raison que
   `routes.test.ts` : l'application est une cible navigateur. */
const SOURCES = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const sourceOf = (suffix: string): string =>
  Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1] ?? '';

/** Un commentaire qui parle de `.map()` n'est pas un `.map()`. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BOUNDARY = sourceOf('/shell/ErrorBoundary.tsx');
const SHELL = sourceOf('/shell/AppShell.tsx');
const ENTRY = sourceOf('/main.tsx');
const POS = sourceOf('/features/vente/screens/Pos.tsx');

/** Tout ce qui sera lu à l'écran par quelqu'un dont l'écran vient de tomber. */
const USER_FACING = [
  FAILURE_PROMISE.headline,
  FAILURE_PROMISE.body,
  ...Object.values(FAILURE_COPY).flatMap((c) => [c.title, c.lead]),
];

describe("limite d'erreur", () => {
  it('bascule en repli dès la première exception', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it('sait rattraper autrement que par le state dérivé', () => {
    // `componentDidCatch` porte le journal : sans lui, une panne ne laisse
    // aucune trace exploitable une fois la tablette rapportée.
    expect(typeof ErrorBoundary.prototype.componentDidCatch).toBe('function');
  });

  it('promet noir sur blanc que rien n\'est perdu', () => {
    expect(FAILURE_PROMISE.headline).toContain("Rien n'est perdu");
    expect(FAILURE_PROMISE.body).toContain('enregistrés sur cet appareil');
    expect(FAILURE_PROMISE.body).toContain("n'efface rien");
  });

  it('propose de reprendre, puis de recharger', () => {
    expect(BOUNDARY).toContain("Reprendre l'écran");
    expect(BOUNDARY).toContain("Recharger l'application");
    // Le bouton du comptoir garde sa cible de 56 px.
    expect(BOUNDARY).toMatch(/size="counter"/);
  });

  it('parle sans jargon système', () => {
    for (const text of USER_FACING) {
      expect(text, text).not.toMatch(/[A-Z]{3,}(_[A-Z]+)*/);
      expect(text, text).not.toMatch(/erreur|exception|undefined|null|stack|render|boundary/i);
    }
  });

  it("n'expose aucun détail technique à l'écran", () => {
    // La pile et le message d'exception partent au journal, jamais dans le JSX.
    const jsx = BOUNDARY.slice(BOUNDARY.indexOf('function ScreenFailure'));
    expect(jsx).not.toContain('error.message');
    expect(jsx).not.toContain('error.stack');
    expect(BOUNDARY).toContain('console.error');
  });

  it('ne détourne pas le filet doré vers une panne', () => {
    // `.derived` marque ce que le système déduit. Une panne ne se déduit pas.
    expect(BOUNDARY).not.toContain('derived');
  });

  it('reste sur les jetons du design system', () => {
    expect(BOUNDARY).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Une barre ancrée passerait sous le rail ; le repli n'en pose aucune.
    expect(BOUNDARY).not.toContain('fixed inset-x-0');
  });
});

describe('câblage des limites', () => {
  it('entoure les écrans routés sans emporter la coque', () => {
    // Rail et onglets sont rendus en dehors : ils survivent à l'écran qui tombe.
    expect(SHELL).toMatch(/<ErrorBoundary[\s\S]{0,200}?>\s*<Outlet\s*\/>/);
    // Sans remontage par chemin, une limite en erreur contaminerait l'écran suivant.
    expect(SHELL).toMatch(/<ErrorBoundary[^>]*key=\{pathname\}/);
  });

  it("garde un filet de dernier recours au-dessus de l'application", () => {
    expect(ENTRY).toMatch(/<ErrorBoundary[\s\S]{0,120}?>\s*<App\s*\/>/);
  });

  it('isole la grille de vente sans enfermer le panier', () => {
    expect(POS).toMatch(/<ErrorBoundary[\s\S]{0,300}?>\s*<ProductGrid/);
    // Le panier flottant et son encaissement doivent rester HORS de la limite :
    // une grille à terre ne doit pas empêcher de terminer la vente en cours.
    const closes = POS.indexOf('</ErrorBoundary>');
    const cartBar = POS.indexOf("navigate('/vente/panier')");
    expect(closes).toBeGreaterThan(0);
    expect(cartBar).toBeGreaterThan(closes);
  });

  it('rend la grille comme un enfant, pas comme une boucle en place', () => {
    // Une boucle écrite dans le rendu de `Pos` s'exécute dans `Pos` : la limite
    // qui l'entoure ne verrait jamais l'exception passer.
    expect(POS).toContain('function ProductGrid');
    const code = withoutComments(POS);
    const pos = code.slice(code.indexOf('export function Pos'), code.indexOf('function ProductGrid'));
    expect(pos).not.toContain('.map(');
    expect(pos).not.toContain('.filter(');
  });
});
