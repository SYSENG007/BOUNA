/**
 * Le registre des features — la source de vérité unique de la navigation.
 *
 * En dérivent, sans duplication : les routes, les onglets, le rail, le tiroir
 * d'opérations, les raccourcis du profil, et l'écran Équipe où le manager
 * accorde les accès. Ce dernier point est le plus important : le manager coche
 * « Réceptionner une livraison », exactement le libellé que l'utilisateur lira
 * dans son tiroir. Même vocabulaire des deux côtés, aucune notice à écrire.
 *
 * Ajouter un écran, c'est ajouter une ligne ici. Oublier de le faire, c'est
 * écrire un écran que personne n'atteindra — ce qui est préférable à un écran
 * atteignable par quelqu'un qui n'y a pas droit.
 */

import type { ComponentType, SVGProps } from 'react';
import type { Capability, FeatureId } from '../domain/capabilities';
import { CAPABILITY_LABEL } from '../domain/capabilities';
import {
  IconAlert, IconAnalytics, IconCart, IconCash, IconCheck, IconDay, IconEdit, IconHome,
  IconProduction, IconReceive, IconSell, IconSettings, IconStock, IconTeam, IconTransfer,
  IconUser, IconWaste, IconClose,
} from '../design-system/icons';

export type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface Operation {
  id: string;
  /** Le libellé du geste, à l'infinitif. Repris tel quel dans l'écran Équipe. */
  label: string;
  /** Une ligne qui dit ce que l'opération produit — pas ce qu'elle affiche. */
  hint: string;
  /**
   * La destination, quand elle existe. Une capacité peut être accordée avant
   * que son écran ne soit écrit — c'est le cas de l'approbation d'achat, dont
   * la fonction serveur existe et est gardée, mais dont l'interface reste à
   * faire. Ces opérations restent délégables depuis Équipe ; elles n'entrent
   * simplement pas dans le tiroir, qui ne propose que ce qui mène quelque part.
   */
  to?: string;
  requires: Capability;
  Icon: IconType;
  /**
   * Vrai quand l'opération crée un fait daté (une vente, une perte, une
   * réception). Ces opérations peuplent le tiroir « Déclarer » ; les autres
   * sont des consultations.
   */
  declares: boolean;
}

export interface Feature {
  id: FeatureId;
  label: string;
  /** Libellé court, pour un onglet de 60 px de large. */
  short: string;
  Icon: IconType;
  home: string;
  /** Une seule de ces capacités suffit à rendre la feature visible. */
  homeRequires: Capability[];
  operations: Operation[];
}

export const FEATURES: Feature[] = [
  {
    id: 'VENTE',
    label: 'Vente',
    short: 'Vendre',
    Icon: IconSell,
    home: '/vente',
    // Voir les ventes n'est pas vendre : `VIEW_ALL_SALES` ouvre l'historique,
    // pas le comptoir, et ne doit donc pas faire apparaître cet onglet.
    homeRequires: ['SELL'],
    operations: [
      {
        id: 'vente.encaisser', label: CAPABILITY_LABEL.SELL,
        hint: 'Sort le stock du comptoir et fige la marge de la vente',
        to: '/vente', requires: 'SELL', Icon: IconSell, declares: true,
      },
      {
        id: 'vente.historique', label: 'Voir mes ventes',
        hint: 'Le détail de chaque vente, avec son heure',
        to: '/vente/historique', requires: 'SELL', Icon: IconCart, declares: false,
      },
      {
        id: 'vente.toutes', label: CAPABILITY_LABEL.VIEW_ALL_SALES,
        hint: 'Les ventes de tout le monde, pas seulement les siennes',
        to: '/vente/historique', requires: 'VIEW_ALL_SALES', Icon: IconCart, declares: false,
      },
      {
        id: 'vente.annuler', label: CAPABILITY_LABEL.VOID_SALE,
        hint: 'Compense par des mouvements inverses — rien ne se supprime',
        to: '/vente/historique', requires: 'VOID_SALE', Icon: IconClose, declares: true,
      },
      {
        id: 'vente.caisse', label: CAPABILITY_LABEL.MANAGE_CASH_SESSION,
        hint: 'Compte le tiroir et ouvre un écart si le compte ne tombe pas juste',
        to: '/finance/caisse', requires: 'MANAGE_CASH_SESSION', Icon: IconCash, declares: true,
      },
    ],
  },
  {
    id: 'STOCK',
    label: 'Stock',
    short: 'Stock',
    Icon: IconStock,
    home: '/stock',
    homeRequires: ['VIEW_STOCK'],
    operations: [
      {
        id: 'stock.etat', label: CAPABILITY_LABEL.VIEW_STOCK,
        hint: 'Ce que les mouvements donnent, emplacement par emplacement',
        to: '/stock', requires: 'VIEW_STOCK', Icon: IconStock, declares: false,
      },
      {
        id: 'stock.perte', label: CAPABILITY_LABEL.RECORD_WASTE,
        hint: 'Sort la quantité du stock et impute son coût',
        to: '/stock/perte', requires: 'RECORD_WASTE', Icon: IconWaste, declares: true,
      },
      {
        id: 'stock.transfert', label: CAPABILITY_LABEL.TRANSFER_STOCK,
        hint: 'Deux mouvements liés — rien ne se perd entre deux emplacements',
        to: '/stock/transfert', requires: 'TRANSFER_STOCK', Icon: IconTransfer, declares: true,
      },
      {
        id: 'stock.inventaire', label: CAPABILITY_LABEL.COUNT_INVENTORY,
        hint: 'Saisie à l\'aveugle, puis révélation de l\'écart',
        to: '/stock/inventaire', requires: 'COUNT_INVENTORY', Icon: IconCheck, declares: true,
      },
      {
        id: 'stock.ecarts', label: CAPABILITY_LABEL.RESOLVE_VARIANCE,
        hint: 'Donne un motif à ce qui manque — et referme la question',
        to: '/stock/ecarts', requires: 'RESOLVE_VARIANCE', Icon: IconAlert, declares: true,
      },
    ],
  },
  {
    id: 'PRODUCTION',
    label: 'Production',
    short: 'Préparer',
    Icon: IconProduction,
    home: '/production',
    // `EDIT_RECIPE` mène aux recettes, pas à la production du jour.
    homeRequires: ['PRODUCE'],
    operations: [
      {
        id: 'prod.apreparer', label: 'Voir ce qu\'il y a à préparer',
        hint: 'Ce que la vitesse de vente réclame pour la fin de journée',
        to: '/production', requires: 'PRODUCE', Icon: IconProduction, declares: false,
      },
      {
        id: 'prod.batch', label: CAPABILITY_LABEL.PRODUCE,
        hint: 'Consomme les ingrédients de la recette et calcule le rendement',
        to: '/production/preparation', requires: 'PRODUCE', Icon: IconProduction, declares: true,
      },
      {
        id: 'prod.recettes', label: CAPABILITY_LABEL.EDIT_RECIPE,
        hint: 'Une recette déjà utilisée est gelée — la modifier crée une version',
        to: '/production/recettes', requires: 'EDIT_RECIPE', Icon: IconEdit, declares: false,
      },
    ],
  },
  {
    id: 'APPRO',
    label: 'Approvisionnement',
    short: 'Acheter',
    Icon: IconReceive,
    home: '/appro',
    // Réceptionner ou tenir les fournisseurs n'ouvre pas la liste de courses.
    homeRequires: ['REQUEST_PURCHASE', 'PLACE_ORDER'],
    operations: [
      {
        id: 'appro.besoins', label: 'Voir la liste de courses',
        hint: 'Calculée depuis les seuils et la vitesse de sortie',
        to: '/appro', requires: 'REQUEST_PURCHASE', Icon: IconCart, declares: false,
      },
      {
        id: 'appro.commande', label: CAPABILITY_LABEL.PLACE_ORDER,
        hint: 'Fixe le fournisseur et les prix attendus',
        to: '/appro/commande', requires: 'PLACE_ORDER', Icon: IconCart, declares: true,
      },
      {
        id: 'appro.approbation', label: CAPABILITY_LABEL.APPROVE_PURCHASE,
        hint: 'Débloque une demande avant qu\'elle parte au fournisseur',
        requires: 'APPROVE_PURCHASE', Icon: IconCheck, declares: true,
      },
      {
        id: 'appro.fournisseurs', label: CAPABILITY_LABEL.MANAGE_SUPPLIERS,
        hint: 'Coordonnées, conditions et historique de prix',
        requires: 'MANAGE_SUPPLIERS', Icon: IconTeam, declares: false,
      },
      {
        id: 'appro.reception', label: CAPABILITY_LABEL.RECEIVE_GOODS,
        hint: 'Entre la marchandise, recalcule le coût moyen, enregistre les frais',
        to: '/appro/reception', requires: 'RECEIVE_GOODS', Icon: IconReceive, declares: true,
      },
    ],
  },
  {
    id: 'FINANCE',
    label: 'Finance',
    short: 'Finance',
    Icon: IconCash,
    home: '/finance',
    // `CLOSE_DAY` mène à la caisse, pas au journal des dépenses.
    homeRequires: ['RECORD_EXPENSE', 'VIEW_FINANCES'],
    operations: [
      {
        id: 'finance.depenses', label: 'Voir les dépenses',
        hint: 'Toutes les sorties, avec leur auteur et leur moyen de paiement',
        to: '/finance', requires: 'RECORD_EXPENSE', Icon: IconCash, declares: false,
      },
      {
        id: 'finance.depense', label: CAPABILITY_LABEL.RECORD_EXPENSE,
        hint: 'Sort l\'argent de la trésorerie et impute la charge',
        to: '/finance/depense', requires: 'RECORD_EXPENSE', Icon: IconCash, declares: true,
      },
      {
        id: 'finance.tresorerie', label: 'Suivre la trésorerie',
        hint: 'Ce qui entre, ce qui sort, et ce qui reste — moyen par moyen',
        to: '/finance/tresorerie', requires: 'VIEW_FINANCES', Icon: IconAnalytics, declares: false,
      },
      {
        id: 'finance.cloture', label: CAPABILITY_LABEL.CLOSE_DAY,
        hint: 'Cinq étapes, puis la journée se verrouille',
        to: '/finance/caisse', requires: 'CLOSE_DAY', Icon: IconDay, declares: true,
      },
      {
        id: 'finance.reouverture', label: CAPABILITY_LABEL.REOPEN_DAY,
        hint: 'Rouvrir n\'annule pas : la clôture reste, le motif est archivé',
        to: '/finance/caisse', requires: 'REOPEN_DAY', Icon: IconDay, declares: true,
      },
    ],
  },
  {
    id: 'PILOTAGE',
    label: 'Pilotage',
    short: "Aujourd'hui",
    Icon: IconDay,
    home: '/pilotage',
    homeRequires: ['VIEW_DASHBOARD'],
    operations: [
      {
        id: 'pilot.dashboard', label: CAPABILITY_LABEL.VIEW_DASHBOARD,
        hint: 'Ventes, marge, trésorerie, écarts — et qui a fait quoi',
        to: '/pilotage', requires: 'VIEW_DASHBOARD', Icon: IconAnalytics, declares: false,
      },
      {
        id: 'pilot.equipe', label: CAPABILITY_LABEL.MANAGE_TEAM,
        hint: 'Accorde et retire les accès, opération par opération',
        to: '/pilotage/equipe', requires: 'MANAGE_TEAM', Icon: IconTeam, declares: false,
      },
      {
        id: 'pilot.catalogue', label: CAPABILITY_LABEL.MANAGE_CATALOG,
        hint: 'Articles, prix de vente, seuils de réapprovisionnement',
        to: '/pilotage/catalogue', requires: 'MANAGE_CATALOG', Icon: IconHome, declares: false,
      },
      {
        id: 'pilot.emplacements', label: CAPABILITY_LABEL.MANAGE_LOCATIONS,
        hint: 'Comptoir, cuisine, frigo, réserve',
        to: '/pilotage/emplacements', requires: 'MANAGE_LOCATIONS', Icon: IconSettings, declares: false,
      },
      {
        id: 'pilot.reglages', label: CAPABILITY_LABEL.MANAGE_SETTINGS,
        hint: 'Suivi simple ou suivi précis — ce que l’application exige, et ce qu’elle déduit',
        to: '/pilotage/reglages', requires: 'MANAGE_SETTINGS', Icon: IconSettings, declares: false,
      },
      {
        /*
         * VOLONTAIREMENT SANS `to`.
         *
         * L'écran existe et sa route est déclarée (`/pilotage/simulation`),
         * mais aucune destination n'est publiée ici — donc le tiroir et les
         * raccourcis du profil l'ignorent, et aucun lien ne le montre. On y va
         * en tapant l'adresse. C'est un choix du propriétaire : le bac à sable
         * ne doit pas se découvrir en explorant les menus, parce qu'y entrer
         * change la maison dans laquelle on travaille.
         *
         * L'opération reste inscrite ici, et c'est tout l'intérêt du `to`
         * optionnel : c'est ce registre qui rend une capacité délégable depuis
         * l'écran Équipe. Un droit qu'on ne pourrait pas retirer ne serait pas
         * un droit accordé.
         */
        id: 'pilot.simulation', label: CAPABILITY_LABEL.RUN_SIMULATION,
        hint: 'Jouer une journée entière sur une copie, sans toucher aux chiffres',
        requires: 'RUN_SIMULATION', Icon: IconSettings, declares: false,
      },
      {
        id: 'pilot.journal', label: CAPABILITY_LABEL.VIEW_AUDIT_LOG,
        hint: 'Chaque opération, son auteur, et sous quelle autorisation',
        to: '/pilotage/journal', requires: 'VIEW_AUDIT_LOG', Icon: IconUser, declares: false,
      },
    ],
  },
];

/**
 * Ordre de priorité des features — pour la barre d'onglets, le rail et la page
 * d'atterrissage.
 *
 * Il vit ici et pas dans la coque : sinon l'onglet d'accueil d'un préparateur
 * et la page sur laquelle il atterrit finissent par diverger, ce qui donne
 * l'impression que l'application se trompe de destination.
 *
 * Le pilotage passe devant parce qu'il répond à « où en est-on ? », la vente
 * juste après parce que c'est là qu'on passe ses journées. Le stock ferme la
 * marche : très consulté, mais on n'y agit pas en continu.
 */
export const FEATURE_PRIORITY: FeatureId[] = [
  'PILOTAGE', 'VENTE', 'PRODUCTION', 'APPRO', 'FINANCE', 'STOCK',
];

export function byPriority(features: Feature[]): Feature[] {
  return [...features].sort(
    (a, b) => FEATURE_PRIORITY.indexOf(a.id) - FEATURE_PRIORITY.indexOf(b.id),
  );
}

/** Les features dont la personne détient au moins une capacité d'accueil. */
export function featuresFor(capabilities: readonly Capability[]): Feature[] {
  return byPriority(FEATURES.filter((f) => f.homeRequires.some((c) => capabilities.includes(c))));
}

/** Toutes les opérations autorisées, dans l'ordre du registre. */
export function operationsFor(capabilities: readonly Capability[]): Operation[] {
  return FEATURES.flatMap((f) => f.operations).filter((o) => capabilities.includes(o.requires));
}

/** Les opérations autorisées d'une feature, groupées pour le tiroir. */
export function operationsByFeature(
  capabilities: readonly Capability[],
  declaresOnly?: boolean,
  /** Vrai pour le tiroir : on ne propose pas un geste qui ne mène nulle part. */
  routableOnly = false,
): { feature: Feature; operations: Operation[] }[] {
  return byPriority(FEATURES).map((feature) => ({
    feature,
    operations: feature.operations.filter(
      (o) => capabilities.includes(o.requires)
        && (declaresOnly === undefined || o.declares === declaresOnly)
        && (!routableOnly || !!o.to),
    ),
  })).filter((g) => g.operations.length > 0);
}

/**
 * Les capacités d'une feature, une seule fois chacune.
 *
 * Deux opérations peuvent reposer sur la même capacité — consulter les ventes
 * et en enregistrer une demandent toutes deux SELL. Les écrans qui parlent de
 * DROITS (le profil, l'écran Équipe) doivent donc dédoublonner : sinon le
 * manager voit deux cases pour un seul droit, et en cocher une décoche l'autre.
 * Les écrans qui parlent de GESTES (le tiroir) gardent les deux, eux.
 */
export function capabilitiesByFeature(
  capabilities?: readonly Capability[],
): { feature: Feature; rows: { capability: Capability; label: string; hint: string }[] }[] {
  return byPriority(FEATURES).map((feature) => {
    const seen = new Set<Capability>();
    const rows: { capability: Capability; label: string; hint: string }[] = [];
    for (const op of feature.operations) {
      if (seen.has(op.requires)) continue;
      if (capabilities && !capabilities.includes(op.requires)) continue;
      seen.add(op.requires);
      rows.push({ capability: op.requires, label: CAPABILITY_LABEL[op.requires], hint: op.hint });
    }
    return { feature, rows };
  }).filter((g) => g.rows.length > 0);
}

/**
 * Où atterrir à la connexion.
 *
 * Le tableau de bord si on y a droit, sinon la première feature dont on tient
 * une capacité. Personne n'arrive sur une page vide : quelqu'un qui n'a aucune
 * capacité voit son profil, où il lira qu'il attend des accès.
 */
export function homeFor(capabilities: readonly Capability[]): string {
  if (capabilities.includes('VIEW_DASHBOARD')) return '/pilotage';
  return featuresFor(capabilities)[0]?.home ?? '/moi';
}
