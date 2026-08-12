import type { EventType, Role, Severity } from './types';

/**
 * Le parcours opérationnel : qui fait quoi, quel événement en découle,
 * et qui ce fait réveille.
 *
 * Cette table n'est pas de la documentation posée à côté du code — c'est elle
 * qui décrit les règles de notification du §44 (Trigger · Condition · Recipients
 * · Severity · Cooldown · Action). Le moteur serveur consommera la même structure.
 */

export interface FlowStep {
  id: string;
  /** Étape du continuum : Argent → Achat → Matière → Transformation → Produit → Client → Argent. */
  stage: 'APPRO' | 'ACHAT' | 'STOCK' | 'PRODUCTION' | 'VENTE' | 'CLOTURE';
  actor: Role;
  /** Ce que la personne déclare, dit à la première personne. */
  declares: string;
  event: EventType;
  /** Ce que le système en déduit, sans qu'on le lui demande. */
  derives: string[];
  /** Qui est réveillé, et à quelle condition. */
  triggers: {
    condition: string;
    recipients: Role[];
    severity: Severity;
    action: string;
    cooldownMinutes: number;
  }[];
  route: string;
}

export const FLOW: FlowStep[] = [
  {
    id: 'replenish',
    stage: 'APPRO',
    actor: 'PROCUREMENT',
    declares: "Je vois ce qu'il faut acheter aujourd'hui",
    event: 'PURCHASE_REQUESTED',
    derives: [
      'Quantité recommandée = stock cible − stock actuel',
      'Regroupement par fournisseur habituel',
      'Budget estimé au dernier prix connu',
    ],
    triggers: [
      {
        condition: 'stock ≤ stock minimum',
        recipients: ['PROCUREMENT', 'MANAGER'],
        severity: 'ACTION_REQUIRED',
        action: 'Ajouter la quantité manquante au bon de commande',
        cooldownMinutes: 120,
      },
    ],
    route: '/approvisionnement',
  },
  {
    id: 'purchase',
    stage: 'ACHAT',
    actor: 'PROCUREMENT',
    declares: "J'ai acheté 20 L de lait à 1 100 FCFA",
    event: 'GOODS_RECEIVED',
    derives: [
      'Entrée de stock à l’emplacement de réception',
      'Nouveau coût moyen pondéré de l’article',
      'Dépense enregistrée et rattachée au fournisseur',
      'Point d’historique de prix',
    ],
    triggers: [
      {
        condition: 'prix > moyenne 30 jours + 10 %',
        recipients: ['MANAGER', 'OWNER'],
        severity: 'ATTENTION',
        action: 'Comparer les fournisseurs sur cet article',
        cooldownMinutes: 720,
      },
      {
        condition: 'réception partielle',
        recipients: ['PROCUREMENT'],
        severity: 'INFO',
        action: 'Suivre le reliquat attendu',
        cooldownMinutes: 60,
      },
    ],
    route: '/achats/nouveau',
  },
  {
    id: 'batch',
    stage: 'PRODUCTION',
    actor: 'PREPARER',
    declares: "J'ai préparé 27 Vanilla Iced Coffee",
    event: 'BATCH_COMPLETED',
    derives: [
      'Consommation de chaque ingrédient selon la recette figée',
      'Sortie de stock produit fini à l’emplacement choisi',
      'Rendement du batch (produit ÷ prévu)',
      'Coût de revient réel du batch',
    ],
    triggers: [
      {
        condition: 'rendement < 90 %',
        recipients: ['MANAGER'],
        severity: 'ATTENTION',
        action: 'Examiner les pertes de préparation',
        cooldownMinutes: 240,
      },
      {
        condition: 'matière insuffisante pour le prochain batch',
        recipients: ['PREPARER', 'PROCUREMENT'],
        severity: 'ACTION_REQUIRED',
        action: 'Déclencher un réapprovisionnement',
        cooldownMinutes: 60,
      },
    ],
    route: '/production/batch',
  },
  {
    id: 'transfer',
    stage: 'STOCK',
    actor: 'PREPARER',
    declares: "J'ai transféré 18 unités vers le comptoir",
    event: 'STOCK_TRANSFERRED',
    derives: [
      'Sortie cuisine et entrée point de vente, même identifiant de transfert',
      'Disponibilité mise à jour sur la grille du vendeur',
    ],
    triggers: [
      {
        condition: 'stock comptoir < demande estimée sur 2 h',
        recipients: ['PREPARER', 'MANAGER'],
        severity: 'ACTION_REQUIRED',
        action: 'Lancer un batch complémentaire',
        cooldownMinutes: 30,
      },
    ],
    route: '/stock',
  },
  {
    id: 'sale',
    stage: 'VENTE',
    actor: 'SELLER',
    declares: "J'ai vendu 2 Vanilla, payées en espèces",
    event: 'SALE_COMPLETED',
    derives: [
      'Sortie de stock au point de vente',
      'Coût des produits vendus figé au coût du jour',
      'Marge brute de la vente',
      'Encaissement rattaché à la session de caisse',
    ],
    triggers: [
      {
        condition: 'stock disponible < 10 unités',
        recipients: ['PREPARER', 'MANAGER'],
        severity: 'ACTION_REQUIRED',
        action: 'Préparer un nouveau batch',
        cooldownMinutes: 30,
      },
      {
        condition: 'annulation de vente',
        recipients: ['MANAGER', 'OWNER'],
        severity: 'ATTENTION',
        action: 'Vérifier le motif dans le journal d’audit',
        cooldownMinutes: 0,
      },
    ],
    route: '/vendre',
  },
  {
    id: 'waste',
    stage: 'STOCK',
    actor: 'SELLER',
    declares: "J'ai jeté 1 préparation",
    event: 'WASTE_RECORDED',
    derives: [
      'Sortie de stock motivée',
      'Coût de la perte valorisé au coût moyen',
      'Contribution à la ligne « où perdons-nous de l’argent »',
    ],
    triggers: [
      {
        condition: 'pertes du jour > seuil défini',
        recipients: ['MANAGER', 'OWNER'],
        severity: 'ATTENTION',
        action: 'Analyser les motifs de perte',
        cooldownMinutes: 360,
      },
    ],
    route: '/stock/perte',
  },
  {
    id: 'count',
    stage: 'STOCK',
    actor: 'MANAGER',
    declares: "J'ai compté 7,5 L de lait",
    event: 'STOCK_COUNTED',
    derives: [
      'Écart entre théorique et compté',
      'Mouvement d’ajustement motivé',
      'Alimentation de l’analyse théorique vs réel',
    ],
    triggers: [
      {
        condition: 'écart supérieur au seuil de tolérance',
        recipients: ['MANAGER', 'OWNER'],
        severity: 'CRITICAL',
        action: 'Justifier l’écart et vérifier les recettes',
        cooldownMinutes: 0,
      },
    ],
    route: '/stock/inventaire',
  },
  {
    id: 'closing',
    stage: 'CLOTURE',
    actor: 'SELLER',
    declares: "J'ai compté 143 500 FCFA en caisse",
    event: 'CASH_SESSION_CLOSED',
    derives: [
      'Attendu = fond de caisse + ventes espèces',
      'Écart de caisse',
      'Verrouillage de la session',
    ],
    triggers: [
      {
        condition: 'écart ≠ 0',
        recipients: ['MANAGER'],
        severity: 'ACTION_REQUIRED',
        action: 'Demander un motif et valider',
        cooldownMinutes: 0,
      },
      {
        condition: 'journée clôturée',
        recipients: ['OWNER'],
        severity: 'INFO',
        action: 'Consulter le Daily Pulse',
        cooldownMinutes: 0,
      },
    ],
    route: '/cloture',
  },
];

export const STAGE_LABEL: Record<FlowStep['stage'], string> = {
  APPRO: 'Besoin',
  ACHAT: 'Achat',
  STOCK: 'Stock',
  PRODUCTION: 'Transformation',
  VENTE: 'Vente',
  CLOTURE: 'Clôture',
};
