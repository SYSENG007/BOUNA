import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { fcfa } from '../../../domain/money';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, Card } from '../../../design-system/components/primitives';
import { DayClosing } from './DayClosing';
import { businessDateOf } from '../../../domain/closing';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '000', '0', '⌫'];

/** Pavé numérique partagé par l'ouverture et la clôture : même geste, même forme. */
function Keypad({ onPress }: { onPress: (key: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          onClick={() => onPress(k)}
          className="no-select num min-h-[60px] rounded-[6px] border border-ink-200 bg-surface text-[20px] text-ink-900 transition-colors active:bg-sable-pale"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

/** Saisie d'un montant au pavé, avec sa garde de longueur. */
function useAmount() {
  const [raw, setRaw] = useState('');
  const press = (k: string) => {
    if (k === '⌫') setRaw((r) => r.slice(0, -1));
    else setRaw((r) => (r.length > 9 ? r : r + k));
  };
  return { raw, press, value: Number(raw || 0), reset: () => setRaw('') };
}

/**
 * La caisse a deux moments, et un seul écran.
 *
 * Tant qu'aucun shift n'est ouvert, il n'y a rien à compter : l'écran demande
 * le fond de caisse. Une fois le shift ouvert, il demande le comptage. Séparer
 * les deux en deux destinations obligerait à savoir laquelle chercher — alors
 * que la caisse, elle, n'est jamais que dans un état ou dans l'autre.
 */
export function Closing() {
  const { state } = useBuna();
  /*
   * Une clôture commencée tient l'écran jusqu'au bout.
   *
   * La première étape ferme le tiroir — c'est son objet. Sans cette condition,
   * l'écran basculait aussitôt sur « Ouvrez la caisse » et abandonnait la
   * personne au milieu du gué : quatre étapes restaient à faire, dont le
   * comptage du stock, et plus aucun chemin n'y menait.
   */
  const today = businessDateOf(new Date().toISOString());
  const closingToday = state.closing?.businessDate === today;
  const open = !state.cashSession.closedAt || closingToday;
  /*
   * Un shift ouvert se ferme par la CLÔTURE, pas par un comptage isolé.
   *
   * Cet écran tenait sa propre logique simplifiée — compter le tiroir, écrire
   * l'écart, terminé — pendant que `domain/closing.ts` portait les cinq
   * étapes, testées et importées par personne. Deux façons de fermer la même
   * caisse, c'est une de trop : celle qui restait ne rapprochait pas les
   * canaux, ne comptait pas le stock, et ne verrouillait pas la journée.
   */
  return open ? <DayClosing /> : <OpenShift />;
}

/* ------------------------------------------------------------- Ouverture */

function OpenShift() {
  const { state, openCashSession } = useBuna();
  const navigate = useNavigate();
  const { raw, press, value } = useAmount();

  const shift = state.cashSession.shiftNumber + 1;

  const submit = () => {
    openCashSession(value);
    navigate('/vente', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Ouvrez la caisse"
        subtitle={`Shift #${shift} · fond de caisse`}
        onBack={() => navigate(-1)}
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-4">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Comptez l'argent présent dans le tiroir avant la première vente. C'est ce montant
          qui servira de référence à la clôture — l'écart se mesure à partir de lui.
        </p>

        <Card className="text-center">
          <div className="label-section">Fond de caisse</div>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="t-figure text-[40px] leading-none text-ink-900">
              {raw ? fcfa(value) : '—'}
            </span>
            <span className="text-[13px] text-ink-500">FCFA</span>
          </div>
        </Card>

        <Keypad onPress={press} />

        <p className="text-[13px] text-ink-600">
          Le tiroir peut être vide : saisissez 0, l'ouverture reste nécessaire.
        </p>

        <Button variant="primary" size="counter" full disabled={!raw} onClick={submit}>
          Ouvrir la caisse
        </Button>
      </main>
    </div>
  );
}
