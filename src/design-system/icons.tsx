import type { SVGProps } from 'react';

/**
 * Iconographie BUNA.
 * « Trait 1,6 px, coins arrondis, géométrie simple. Un icône n'est jamais seul :
 *   toujours un mot sous lui. »
 *
 * Grille 24×24, stroke 1.6, currentColor. Le vocabulaire est celui du métier —
 * une tasse pour la vente, un bac pour le stock, une verseuse pour la production —
 * plutôt qu'un jeu générique.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* Accueil — le comptoir : un auvent et sa base. */
export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 10v9h12v-9" />
    <path d="M10 19v-5h4v5" />
  </Svg>
);

/* Ventes — la tasse à emporter : gobelet, couvercle, ceinture. */
export const IconSell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 8h11l-1.1 11.1a1 1 0 0 1-1 .9H8.6a1 1 0 0 1-1-.9L6.5 8Z" />
    <path d="M5.5 5.2h13V8h-13z" />
    <path d="M7.2 13.2h9.6" />
  </Svg>
);

/* Stock — bacs empilés. */
export const IconStock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="5" rx="1" />
    <rect x="3.5" y="14.5" width="17" height="5" rx="1" />
    <path d="M8.5 4.5v5M15.5 4.5v5M8.5 14.5v5M15.5 14.5v5" />
  </Svg>
);

/* Production — la verseuse : bec, anse, niveau. */
export const IconProduction = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6h10l-1.2 12.2a1 1 0 0 1-1 .8H8.2a1 1 0 0 1-1-.8L6 6Z" />
    <path d="M16 8.5c2.2.3 3.2 1.4 3.2 2.9s-1.1 2.4-3 2.6" />
    <path d="M6.6 12.2h8.8" />
  </Svg>
);

/* Réception — le carton qui entre. */
export const IconReceive = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 9.5 12 5.5l7.5 4v8L12 21.5l-7.5-4v-8Z" />
    <path d="M4.5 9.5 12 13.5l7.5-4M12 13.5v8" />
    <path d="M12 2v4.2M10.2 4.6 12 2.4l1.8 2.2" />
  </Svg>
);

/* Caisse — le tiroir et sa fente. */
export const IconCash = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="8.5" width="17" height="10" rx="1.5" />
    <path d="M10 12.5h4" />
    <path d="M6.5 8.5 8 5.2h8l1.5 3.3" />
  </Svg>
);

/* Analyses — trois barres de hauteurs différentes. */
export const IconAnalytics = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M7 20v-6M12 20V6M17 20v-9" />
  </Svg>
);

/* Alerte — triangle, jamais rouge par lui-même. */
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5 21 19.5H3L12 4.5Z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </Svg>
);

/* Transfert — deux flux opposés : ce qui sort, ce qui entre. */
export const IconTransfer = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h13l-3-3" />
    <path d="M20 15H7l3 3" />
  </Svg>
);

/* Recherche */
export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="M15.6 15.6 20 20" />
  </Svg>
);

/* Journée — le soleil au-dessus de la ligne de service. */
export const IconDay = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12.5" r="3.6" />
    <path d="M12 4.5v2M12 18.5v2M4.5 12.5h2M17.5 12.5h2M6.7 7.2l1.4 1.4M15.9 16.4l1.4 1.4M17.3 7.2l-1.4 1.4M8.1 16.4l-1.4 1.4" />
  </Svg>
);

/* Historique — le cadran et sa flèche de retour. */
export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 12a7.8 7.8 0 1 0 2.5-5.7" />
    <path d="M4 4.5V9h4.5" />
    <path d="M12 8.5V12l2.6 1.6" />
  </Svg>
);

/* Équipe */
export const IconTeam = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9.5" cy="8.5" r="3" />
    <path d="M3.8 19c.5-3 2.9-4.6 5.7-4.6s5.2 1.6 5.7 4.6" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.4 14.9c2 .6 3.900 2 4.1 4.1" />
  </Svg>
);

/* Rapport — la feuille et ses lignes. */
export const IconReport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h8l4 4v13H6z" />
    <path d="M14 3.5v4h4" />
    <path d="M9 12h6M9 15.5h6M9 8.5h2" />
  </Svg>
);

/* Paramètres */
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18.01 5.99l-1.56 1.56M7.55 16.45l-1.56 1.56M18.01 18.01l-1.56-1.56M7.55 7.55 5.99 5.99" />
  </Svg>
);

/* Moi — une personne, pas un engrenage : l'onglet parle de vous. */
export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M5 19.5c.6-3.5 3.4-5.4 7-5.4s6.4 1.9 7 5.4" />
  </Svg>
);

/* Plus */
export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

/* ---------------------------------------------------- Icônes d'action */

export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const IconMinus = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14" /></Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="M4.5 12.5 9.5 17.5 19.5 7" /></Svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}><path d="M14.5 5.5 8 12l6.5 6.5" /></Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}><path d="M9.5 5.5 16 12l-6.5 6.5" /></Svg>
);

/* Photo — le cadre et son objectif, pour les visuels produit. */
export const IconPhoto = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="6" width="17" height="13" rx="1.5" />
    <circle cx="12" cy="12.5" r="3.2" />
    <path d="M8.5 6l1.3-2h4.4L15.5 6" />
  </Svg>
);

/* Cloud — état de synchronisation. */
export const IconCloud = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 18.5a4 4 0 0 1-.4-8 5.4 5.4 0 0 1 10.3 1.2 3.4 3.4 0 0 1-.6 6.8H7.5Z" />
  </Svg>
);

/* Perte — la goutte renversée. */
export const IconWaste = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5s5 5.6 5 9a5 5 0 0 1-10 0c0-3.4 5-9 5-9Z" />
    <path d="M6 20.5h12" />
  </Svg>
);

/* Panier */
export const IconCart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4.5h2.2l2.1 10.2h9.5l1.9-7.4H6.4" />
    <circle cx="9.5" cy="19" r="1.4" />
    <circle cx="16.5" cy="19" r="1.4" />
  </Svg>
);

/* Modifier */
export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L4.5 15.5v4Z" />
    <path d="M14.5 7.5l2 2" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
