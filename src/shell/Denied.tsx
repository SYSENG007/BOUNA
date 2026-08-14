import { useNavigate } from 'react-router-dom';
import type { Capability } from '../domain/capabilities';
import { CAPABILITY_LABEL } from '../domain/capabilities';
import { Button, Card } from '../design-system/components/primitives';

/**
 * Ce qu'on montre quand une URL mène là où la personne n'a pas accès.
 *
 * Le message nomme le geste manquant dans les mots de l'écran Équipe — ce qui
 * permet de le demander sans avoir à le deviner — et dit à qui le demander.
 * « 403 » n'a jamais aidé personne à travailler.
 */
export function Denied({ need }: { need: Capability[] }) {
  const navigate = useNavigate();
  const labels = need.map((c) => CAPABILITY_LABEL[c].toLowerCase());

  return (
    <div className="flex flex-1 items-center justify-center bg-ivoire px-4 py-12">
      <Card className="w-full max-w-md space-y-4 text-center">
        <h1 className="font-display text-[22px] leading-tight text-cafe">
          Cet écran ne vous est pas ouvert
        </h1>
        <p className="text-[14px] leading-relaxed text-ink-600">
          Il demande de pouvoir{' '}
          <strong className="text-ink-900">
            {labels.length > 1 ? labels.join(' ou ') : labels[0]}
          </strong>.
          <br />
          Votre manager peut vous l'accorder depuis l'écran Équipe.
        </p>
        <Button full onClick={() => navigate('/')}>Revenir à l'accueil</Button>
      </Card>
    </div>
  );
}
