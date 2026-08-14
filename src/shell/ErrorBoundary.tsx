import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card } from '../design-system/components/primitives';
import { IconAlert } from '../design-system/icons';

/* =================================================================
   Limite d'erreur — un écran blanc ne doit pas pouvoir arrêter le
   comptoir.

   Une exception de rendu non rattrapée vide le document entier :
   plus de menu, plus de panier, plus rien à toucher. En plein
   service, la seule issue devient le rechargement manuel — geste
   que personne ne pense à faire quand l'écran est simplement noir.

   React n'offre que la classe pour intercepter ça :
   `getDerivedStateFromError` et `componentDidCatch` n'ont aucun
   équivalent en composant de fonction, y compris en React 19.
   ================================================================= */

/**
 * La phrase qui porte tout. Quelqu'un qui vient de perdre son affichage en
 * plein service veut d'abord savoir s'il a perdu sa journée — et la réponse
 * est non : chaque évolution d'état est écrite sur l'appareil avant toute
 * idée de réseau. Elle est identique quel que soit l'endroit qui est tombé,
 * parce qu'elle est vraie partout, et nommée à part pour qu'on ne puisse pas
 * l'affaiblir sans le voir.
 */
export const FAILURE_PROMISE = {
  headline: "Rien n'est perdu.",
  body:
    "Vos ventes, vos mouvements de stock et tout ce qui attend d'être envoyé sont enregistrés " +
    "sur cet appareil. Cet arrêt n'efface rien, et l'envoi repart tout seul dès que le réseau revient.",
} as const;

/**
 * Les mots du repli, sortis du JSX pour être relus — et testés — sans
 * monter React. Ce texte est la seule chose que la personne lira d'une
 * panne : il compte autant que le code qui l'affiche.
 */
export const FAILURE_COPY = {
  screen: {
    title: "Cet écran s'est arrêté",
    lead: "Quelque chose l'a interrompu pendant l'affichage. Le menu répond toujours : vous pouvez aussi passer à un autre écran.",
  },
  screenAgain: {
    title: "Cet écran s'est arrêté à nouveau",
    lead: "Reprendre n'a pas suffi. Rechargez l'application : elle repart à neuf et retrouve tout ce qui est enregistré sur cet appareil.",
  },
  app: {
    title: "L'application s'est arrêtée",
    lead: "Quelque chose l'a interrompue avant qu'elle ait pu s'afficher.",
  },
  appAgain: {
    title: "L'application s'est arrêtée à nouveau",
    lead: "Reprendre n'a pas suffi. Rechargez : l'application repart à neuf et retrouve tout ce qui est enregistré sur cet appareil.",
  },
} as const;

interface Props {
  /**
   * Ce qui est protégé, nommé en clair. Part au journal, jamais à l'écran :
   * l'utilisateur n'a rien à faire d'un nom de composant.
   */
  zone: string;
  /**
   * Vrai quand la coque reste debout autour du repli — rail latéral et barre
   * d'onglets. Elle change ce qu'on a le droit de promettre : au niveau du
   * routeur le menu répond encore, au niveau racine il n'y a plus de menu.
   */
  shellIntact?: boolean;
  /**
   * Repli sur mesure. Sert aux limites étroites : la grille de vente peut
   * tomber en laissant le panier et l'encaissement à portée de pouce.
   */
  fallback?: (retry: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
  /**
   * Nombre d'arrêts depuis le montage. Au deuxième, reprendre ne suffit
   * visiblement pas : on cesse de le proposer en premier et on met le
   * rechargement en avant, plutôt que de laisser quelqu'un boucler.
   */
  failures: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, failures: 0 };

  static getDerivedStateFromError(): Pick<State, 'failed'> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState((prev) => ({ failures: prev.failures + 1 }));

    /* Le comptoir ne lit pas la console : ce journal sert au diagnostic à
       froid, une fois la tablette rapportée. On y met de quoi rejouer la
       panne — l'endroit, le chemin, l'état réseau, la pile — précisément ce
       qu'on refuse d'afficher, où ça inquiéterait sans aider à réparer. */
    console.error(`[BUNA] ${this.props.zone} — rendu interrompu`, {
      zone: this.props.zone,
      chemin: window.location.pathname + window.location.search,
      reseau: navigator.onLine ? 'en ligne' : 'hors ligne',
      horodatage: new Date().toISOString(),
      arret: this.state.failures + 1,
      message: error?.message ?? String(error),
      pile: error?.stack,
      composants: info.componentStack,
    });
  }

  /* Reprendre sans recharger : on oublie l'erreur et React remonte le
     sous-arbre à neuf. Rien d'autre ne bouge — ni le store, ni la file
     d'attente, ni le panier, tous montés au-dessus de cette limite. */
  retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return (
      <ScreenFailure
        shellIntact={this.props.shellIntact === true}
        repeated={this.state.failures > 1}
        onRetry={this.retry}
      />
    );
  }
}

/**
 * Le repli par défaut. Volontairement sans dépendance : ni store, ni routeur,
 * ni réseau. Ce qui vient de tomber peut être exactement ce dont un repli
 * bavard aurait eu besoin, et un repli qui plante rend l'écran blanc qu'on
 * cherchait à éviter.
 */
function ScreenFailure({
  shellIntact, repeated, onRetry,
}: { shellIntact: boolean; repeated: boolean; onRetry: () => void }) {
  const copy = FAILURE_COPY[
    shellIntact ? (repeated ? 'screenAgain' : 'screen') : (repeated ? 'appAgain' : 'app')
  ];
  const reload = () => window.location.reload();

  const reprendre = (
    <Button variant={repeated ? 'secondary' : 'primary'} size="counter" full onClick={onRetry}>
      Reprendre l'écran
    </Button>
  );
  const recharger = (
    <Button variant={repeated ? 'primary' : 'secondary'} size="counter" full onClick={reload}>
      Recharger l'application
    </Button>
  );

  return (
    <div className="flex flex-1 items-center justify-center bg-ivoire px-4 py-12">
      <Card className="w-full max-w-md space-y-5">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-critique-pale text-critique-deep"
            aria-hidden
          >
            <IconAlert size={20} />
          </span>
          <div className="min-w-0">
            {/* `role="alert"` : au comptoir l'écran change sous les yeux, mais un
                lecteur d'écran doit l'apprendre autrement que par la couleur. */}
            <h1 role="alert" className="font-display text-[22px] leading-tight text-cafe">
              {copy.title}
            </h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-600">{copy.lead}</p>
          </div>
        </div>

        {/* La promesse est encadrée, pas noyée dans le paragraphe : c'est la
            ligne qu'on doit pouvoir lire sans lire le reste. Pas de filet doré
            ici — une panne n'est pas une déduction du système. */}
        <div className="rounded-[6px] border border-ink-200 bg-ivoire px-4 py-3">
          <p className="text-[14px] leading-relaxed text-ink-700">
            <strong className="text-ink-900">{FAILURE_PROMISE.headline}</strong>{' '}
            {FAILURE_PROMISE.body}
          </p>
        </div>

        {/* L'action la plus douce d'abord — sauf au deuxième arrêt, où l'on a
            la preuve qu'elle ne répare pas. */}
        <div className="space-y-2">
          {repeated ? <>{recharger}{reprendre}</> : <>{reprendre}{recharger}</>}
        </div>

        {repeated && (
          <p className="text-[13px] leading-relaxed text-ink-500">
            Si l'écran s'arrête encore après le rechargement, dites-le à votre manager : le
            problème vient de l'application, pas de votre appareil.
          </p>
        )}
      </Card>
    </div>
  );
}
