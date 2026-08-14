import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, SUPPLIERS } from '../../../store/BunaStore';
import { LOC } from '../../../store/referentials';
import { UNIT_LABEL } from '../../../domain/types';
import { fcfaFull } from '../../../domain/money';
import {
  EXPENSE_LABEL, PAYMENT_LABEL, type ExpenseCategory, type PaymentMethod,
} from '../../../domain/types';
import { ScreenHeader } from '../../../design-system/components/patterns';
import {
  Button, Card, Field, SectionLabel, SelectField,
} from '../../../design-system/components/primitives';

const CATEGORIES: ExpenseCategory[] = [
  'MATIERE', 'EMBALLAGE', 'TRANSPORT', 'ENERGIE', 'SALAIRE', 'REPARATION', 'EQUIPEMENT', 'AUTRE',
];

const METHODS: PaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'];

/* Coupures courantes : la plupart des dépenses terrain tombent sur ces montants. */
const QUICK_AMOUNTS = [2000, 5000, 10000, 20000];

/**
 * Enregistrer une dépense (§38).
 *
 * §39 — une dépense directe n'entre PAS en stock. Un achat de marchandise passe
 * par la réception, qui crée à la fois la dépense et l'entrée de stock. L'écran
 * le dit explicitement pour éviter la double saisie.
 */
export function NewExpense() {
  const { state, recordExpense, receiveGoods } = useBuna();
  const navigate = useNavigate();

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('TRANSPORT');
  const [description, setDescription] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');

  // Fields for MATIERE
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');

  const value = Number(amount || 0);
  
  const isMatiere = category === 'MATIERE';
  const descriptionMissing = !isMatiere && description.trim().length === 0;
  const matiereMissing = isMatiere && (!itemId || Number(quantity) <= 0);
  
  const canSubmit = value > 0 && !descriptionMissing && !matiereMissing;

  const rawItems = state.items.filter(i => i.kind !== 'FINISHED' && !i.archived);
  const selectedItem = rawItems.find(i => i.id === itemId);

  const submit = () => {
    if (!canSubmit) return;
    
    if (isMatiere) {
      receiveGoods({
        supplierId: supplierId || 'unknown',
        locationId: LOC.KITCHEN, // Default receiving location
        lines: [{
          itemId: itemId,
          quantity: Number(quantity),
          unitPrice: value / Number(quantity)
        }],
        transportCost: 0,
        paymentMethod
      });
    } else {
      recordExpense({
        amount: value,
        category,
        description: description.trim(),
        supplierId: supplierId || undefined,
        paymentMethod,
      });
    }
    navigate('/finance', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Nouvelle dépense" onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        <Card className="text-center">
          <SectionLabel>Montant</SectionLabel>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="t-figure text-[40px] leading-none text-ink-900">
              {value > 0 ? fcfaFull(value).replace(' FCFA', '') : '—'}
            </span>
            <span className="text-[13px] text-ink-500">FCFA</span>
          </div>
        </Card>

        <div className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className={clsx(
                'no-select num min-h-[48px] rounded-[6px] text-[13px] transition-colors',
                value === v
                  ? 'border-2 border-brun bg-sable-pale text-cafe'
                  : 'border border-ink-200 bg-surface text-ink-700',
              )}
            >
              {v / 1000}k
            </button>
          ))}
        </div>

        <Field
          label="Montant exact"
          type="number"
          inputMode="numeric"
          suffix="FCFA"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div>
          <SectionLabel className="mb-2">Catégorie</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={clsx(
                  'no-select min-h-[48px] rounded-[6px] text-[14px] transition-colors',
                  category === c
                    ? 'border-2 border-brun bg-sable-pale text-cafe'
                    : 'border border-ink-200 bg-surface text-ink-700',
                )}
              >
                {EXPENSE_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        {isMatiere ? (
          <Card className="space-y-4">
            <SelectField
              label="Article acheté"
              value={itemId}
              onChange={setItemId}
              options={[
                { value: '', label: 'Choisir un article...' },
                ...rawItems.map((i) => ({ value: i.id, label: i.name }))
              ]}
            />
            {selectedItem && (
              <Field
                label={`Quantité (${UNIT_LABEL[selectedItem.unit]})`}
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            )}
          </Card>
        ) : (
          <Field
            label="Description"
            placeholder="ex. Transport marché → cuisine"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}

        <SelectField
          label="Fournisseur"
          value={supplierId}
          onChange={setSupplierId}
          options={[{ value: '', label: 'Aucun' }, ...SUPPLIERS.map((s) => ({ value: s.id, label: s.name }))]}
        />

        <div>
          <SectionLabel className="mb-2">Moyen de paiement</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={clsx(
                  'no-select min-h-[52px] rounded-[6px] text-[14px] transition-colors',
                  paymentMethod === m
                    ? 'border-2 border-brun bg-sable-pale text-cafe'
                    : 'border border-ink-200 bg-surface text-ink-700',
                )}
              >
                {PAYMENT_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {paymentMethod === 'CASH' && value > 0 && (
          <div className="derived">
            <SectionLabel className="mb-1">Effet sur la caisse</SectionLabel>
            <p className="t-small text-ink-700">
              {fcfaFull(value)} de moins dans le fond de caisse attendu à la clôture.
            </p>
          </div>
        )}
      </main>

      <div className="safe-b rail-bar bottom-0 z-40 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        <Button variant="primary" size="counter" full disabled={!canSubmit} onClick={submit}>
          {value <= 0
            ? 'Saisissez un montant'
            : isMatiere && matiereMissing
              ? 'Sélectionnez un article et une quantité'
              : descriptionMissing
                ? 'Décrivez la dépense'
                : `Enregistrer ${fcfaFull(value)}`}
        </Button>
      </div>
    </div>
  );
}
