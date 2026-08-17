import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, Card, SectionLabel } from '../../../design-system/components/primitives';

/**
 * Le bac à sable de simulation.
 *
 * Jouer une journée entière — ouvrir la caisse, réceptionner, vendre, annuler,
 * perdre, dépenser, compter, clôturer — sans qu'une ligne n'entre dans les
 * chiffres de la maison.
 *
 * Un écran à soi, et pas un panneau dans le Profil : entrer en simulation
 * change la maison dans laquelle on travaille, ce qui est de loin le geste le
 * plus conséquent qu'on puisse faire depuis un réglage. Il mérite une
 * destination, une adresse, et la place d'expliquer ce qu'il fait avant qu'on
 * le fasse.
 *
 * Deux gestes, jamais confondus. QUITTER laisse le bac à sable intact — on y
 * revient, ou on va lire ce qu'il a produit. EFFACER supprime. Le message de
 * confirmation reprend le mot du bouton, comme partout ailleurs.
 */
export function Simulation() {
  const {
    can, online, simulating, simulationBusy,
    enterSimulation, leaveSimulation, purgeSimulation,
  } = useBuna();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  const allowed = can('RUN_SIMULATION');

  /* Le réseau est exigé, et une seule fois : c'est le serveur qui déplace le
     profil d'une maison à l'autre. Rien d'autre dans l'application ne demande
     ça — d'où le message explicite plutôt qu'un bouton inerte. */
  const blocked = simulationBusy || !online;

  const act = (rpc: () => Promise<string | null>) => {
    setFailure(null);
    void rpc().then(setFailure);
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Simuler une journée"
        subtitle={simulating ? 'Vous êtes dans le bac à sable' : 'Sans toucher aux chiffres'}
        onBack={() => navigate(-1)}
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-4">
        {simulating ? (
          <Card className="space-y-2.5 border border-info bg-info-pale">
            <SectionLabel>En cours</SectionLabel>
            <p className="text-[13.5px] leading-relaxed text-info-deep">
              Vous travaillez sur une copie du catalogue, avec vos droits habituels. Les ventes,
              les pertes et les dépenses que vous enregistrez ici n'existent que dans le bac à
              sable.
            </p>
            <Button
              full
              disabled={blocked}
              onClick={() => act(leaveSimulation)}
            >
              {simulationBusy ? 'Un instant…' : 'Quitter la simulation'}
            </Button>
            <p className="text-[12px] leading-relaxed text-info-deep/75">
              Quitter ne supprime rien : la simulation vous attend si vous revenez.
            </p>
          </Card>
        ) : (
          <Card className="space-y-2.5">
            <SectionLabel>Ce que ça fait</SectionLabel>
            <p className="text-[13.5px] leading-relaxed text-ink-700">
              L'application vous déplace dans une maison d'essai : le même catalogue, les mêmes
              prix, les mêmes coûts, et vos droits habituels. Vous y tenez une journée entière —
              caisse, réception, ventes, pertes, dépenses, inventaire, clôture — et rien n'entre
              dans les chiffres de la vraie maison.
            </p>
            <p className="text-[13px] leading-relaxed text-ink-600">
              Deux articles ouvrent volontairement sous leur minimum, pour que la liste de courses
              et les alertes de rupture aient quelque chose à dire dès le matin.
            </p>
            <Button
              full
              disabled={blocked || !allowed}
              onClick={() => act(enterSimulation)}
            >
              {simulationBusy ? 'Un instant…' : 'Entrer en simulation'}
            </Button>
          </Card>
        )}

        {!allowed && (
          <Card className="border border-info bg-info-pale">
            <p className="text-[13px] leading-relaxed text-info-deep">
              Vous pouvez lire cette page, pas ouvrir de simulation. C'est un droit qui s'accorde
              depuis l'écran Équipe.
            </p>
          </Card>
        )}

        {!online && (
          <Card>
            <p className="text-[13px] leading-relaxed text-ink-600">
              Entrer ou sortir d'une simulation demande le réseau : c'est le serveur qui vous
              déplace d'une maison à l'autre. Le reste de l'application continue hors ligne.
            </p>
          </Card>
        )}

        {failure && (
          <Card className="border border-critique bg-critique-pale">
            <p className="text-[13px] leading-relaxed text-critique-deep">{failure}</p>
          </Card>
        )}

        {/* Effacer est disponible dans les deux états : depuis l'intérieur —
            l'effacement fait sortir — comme après coup, quand on a quitté et
            qu'on veut que les traces disparaissent. */}
        {allowed && (
          <Card className="space-y-2.5">
            <SectionLabel>Effacer</SectionLabel>
            <p className="text-[13px] leading-relaxed text-ink-600">
              Tout ce qui a été saisi dans le bac à sable disparaît, et les personnes qui y
              travaillent encore reviennent dans la maison. Les chiffres de la maison ne sont pas
              touchés.
            </p>
            <Button
              variant="danger"
              full
              disabled={blocked}
              onClick={() => {
                if (!confirm(
                  "Effacer les données de simulation ? Tout ce qui a été saisi dans le bac à sable "
                  + 'disparaît, et les personnes qui y travaillent encore reviennent dans la '
                  + "maison. Les chiffres de la maison ne sont pas touchés.",
                )) return;
                act(purgeSimulation);
              }}
            >
              Effacer les données de simulation
            </Button>
          </Card>
        )}

        <p className="px-1 text-[12px] leading-relaxed text-ink-500">
          Le parcours d'une journée complète, étape par étape, est décrit dans le manuel de
          l'équipe.
        </p>
      </main>
    </div>
  );
}
