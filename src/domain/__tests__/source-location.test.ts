import { describe, expect, it } from 'vitest';
import { sourceLocation } from '../stock';

const ORDER = ['loc-pos', 'loc-fridge', 'loc-kitchen', 'loc-central'];
const from = (levels: Record<string, number>) => (id: string) => levels[id] ?? 0;

describe("d'où sort la marchandise", () => {
  it('sert le comptoir depuis le comptoir quand il a de quoi', () => {
    const at = from({ 'loc-pos': 10, 'loc-fridge': 40 });
    expect(sourceLocation(at, ORDER, 3, 'loc-pos')).toBe('loc-pos');
  });

  it("va chercher là où c'est quand le comptoir est vide", () => {
    // Le cas qui cassait tout : la production livre au frigo, la vente
    // déduisait du comptoir, et le comptoir plongeait en négatif.
    const at = from({ 'loc-pos': 0, 'loc-fridge': 20 });
    expect(sourceLocation(at, ORDER, 3, 'loc-pos')).toBe('loc-fridge');
  });

  it("prend l'ingrédient au frigo plutôt qu'à la cuisine supposée", () => {
    const at = from({ 'loc-kitchen': 0, 'loc-fridge': 6.2 });
    expect(sourceLocation(at, ORDER, 2, 'loc-kitchen')).toBe('loc-fridge');
  });

  it("choisit celui qui en a le plus quand aucun ne couvre", () => {
    // L'écart doit apparaître là où la marchandise était, pas ailleurs.
    const at = from({ 'loc-pos': 1, 'loc-fridge': 4, 'loc-central': 2 });
    expect(sourceLocation(at, ORDER, 10, 'loc-pos')).toBe('loc-fridge');
  });

  it("retombe sur l'emplacement demandé quand tout est à zéro", () => {
    const at = from({});
    expect(sourceLocation(at, ORDER, 5, 'loc-kitchen')).toBe('loc-kitchen');
  });
});
