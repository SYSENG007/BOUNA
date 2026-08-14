import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '../../store/BunaStore';
import type { Action } from '../../store/BunaStore';
import { uuid } from '../ids';

describe('Interopérabilité (Cross-operability)', () => {
  it('valide le cycle complet: Approvisionnement -> Stock -> Vente -> Caisse', () => {
    let state = initialState;
    const actor = { userId: 'u-bouna', at: new Date().toISOString() };
    
    // 1. On s'assure qu'on a de l'argent dans la caisse d'abord
    const cashId = uuid();
    let action: Action = {
      type: 'COMMIT',
      cashSession: { 
        id: cashId, siteId: 'loc-1', sellerId: actor.userId, shiftNumber: 1, openingCash: 50000, countedCash: null, openedAt: actor.at, closedAt: null 
      }
    };
    state = reducer(state, action);
    expect(state.cashSession.openingCash).toBe(50000);

    // 2. Achat (Sortie d'argent -> Entrée en stock)
    const purchaseId = uuid();
    const expenseId = uuid();
    const mockActor: any = { userId: actor.userId, at: actor.at, userName: 'Test', post: 'OWNER' };
    action = {
      type: 'COMMIT',
      movements: [
        { id: uuid(), itemId: '55555555-0000-0000-0000-000000000001', locationId: 'loc-1', quantity: 10, unit: 'L', movementType: 'PURCHASE_RECEIPT', referenceId: purchaseId, createdAt: actor.at, actor: mockActor }
      ] as any,
      expense: {
        id: expenseId, amount: 10000, category: 'MATIERE', description: 'Achat lait', supplierId: 'sup-1', paymentMethod: 'CASH', userId: actor.userId, createdAt: actor.at, actor: mockActor
      } as any
    };
    state = reducer(state, action);
    
    // Vérification Stock et Finance (Dépense)
    expect(state.movements.find(m => m.referenceId === purchaseId)?.quantity).toBe(10);
    expect(state.expenses.find(e => e.id === expenseId)?.amount).toBe(10000);

    // 3. Vente (Sortie de stock -> Entrée d'argent)
    const saleId = uuid();
    action = {
      type: 'COMMIT',
      movements: [
        { id: uuid(), itemId: '55555555-0000-0000-0000-000000000001', locationId: 'loc-1', quantity: -2, unit: 'L', movementType: 'SALE', referenceId: saleId, createdAt: actor.at, actor: mockActor }
      ] as any,
      sale: {
        id: saleId, locationId: 'loc-1', lines: [{ itemId: '55555555-0000-0000-0000-000000000001', quantity: 2, unitPrice: 2500, name: 'Lait', unitCost: 1000 }], total: 5000, paymentMethod: 'CASH', status: 'COMPLETED', createdAt: actor.at, actor: mockActor
      } as any
    };
    state = reducer(state, action);

    expect(state.sales.find(s => s.id === saleId)?.status).toBe('COMPLETED');
    expect(state.movements.find(m => m.referenceId === saleId)?.quantity).toBe(-2);
  });
});
