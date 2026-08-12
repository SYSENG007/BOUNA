import { useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { fcfa, fcfaFull } from '../../domain/money';
import { PAYMENT_LABEL } from '../../domain/types';
import { can } from '../../domain/permissions';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import {
  Badge, Button, Card, EmptyState, Field,
} from '../../design-system/components/primitives';

/** Historique des ventes. RULE-001 — on annule avec un motif, on ne supprime pas. */
export function Orders() {
  const { state, user, voidSale } = useBuna();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const mayVoid = user ? can(user.role, 'VOID_SALE') : false;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="px-4 pb-3 pt-4">
        <h1 className="t-h1 text-cafe">Commandes</h1>
        <p className="text-[12px] text-ink-500">
          {state.sales.length} vente{state.sales.length > 1 ? 's' : ''} sur cet appareil
        </p>
      </header>

      <main className="flex-1 space-y-3 px-4 pb-28">
        {state.sales.length === 0 ? (
          <EmptyState
            title="Aucune vente"
            body="Les ventes enregistrées sur cet appareil apparaîtront ici, même hors ligne."
          />
        ) : (
          state.sales.map((sale) => (
            <Card key={sale.id} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="num text-[15px] font-medium text-ink-900">#{sale.number}</div>
                  <div className="text-[12px] text-ink-500">
                    {new Date(sale.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    {' · '}{PAYMENT_LABEL[sale.paymentMethod]}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[17px] text-cafe">{fcfaFull(sale.total)}</div>
                  {sale.status === 'COMPLETED' ? (
                    <Badge tone="conforme">Enregistrée</Badge>
                  ) : (
                    <Badge tone="critique">Annulée</Badge>
                  )}
                </div>
              </div>

              <div className="border-t border-ink-100 pt-2 text-[13px] text-ink-600">
                {sale.lines.map((l) => (
                  <div key={l.itemId} className="flex justify-between py-0.5">
                    <span>{l.quantity} × {l.name}</span>
                    <span className="num">{fcfa(l.quantity * l.unitPrice)}</span>
                  </div>
                ))}
              </div>

              {sale.status === 'COMPLETED' && mayVoid && (
                voiding === sale.id ? (
                  <div className="space-y-2 border-t border-ink-100 pt-3">
                    <Field
                      label="Motif de l'annulation"
                      placeholder="ex. erreur de saisie"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="compact" className="flex-1" onClick={() => { setVoiding(null); setReason(''); }}>
                        Retour
                      </Button>
                      <Button
                        variant="danger"
                        size="compact"
                        className="flex-1"
                        disabled={!reason.trim()}
                        onClick={() => { voidSale(sale.id, reason.trim()); setVoiding(null); setReason(''); }}
                      >
                        Confirmer l'annulation
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="ghost" size="compact" onClick={() => setVoiding(sale.id)}>
                    Annuler cette vente
                  </Button>
                )
              )}
            </Card>
          ))
        )}
      </main>
    </div>
  );
}
