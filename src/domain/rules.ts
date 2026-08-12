import type { Item, Notification, Role, Severity, UUID } from './types';
import { replenishmentNeed, stockHealth } from './stock';
import { formatQty } from './units';
import { uuid } from './ids';

/**
 * Moteur de règles opérationnelles (§44-46).
 *
 * Une notification n'est utile que si elle est pertinente, adressée,
 * contextualisée, actionnable et NON RÉPÉTITIVE. Le cooldown et la
 * déduplication sont donc dans le moteur, pas dans l'interface.
 *
 * Le moteur est une fonction pure : mêmes entrées, mêmes sorties. Le portage
 * vers un worker Supabase consommera la même table de règles.
 */

/**
 * Dernier déclenchement par clé de portée : `règle:cible`.
 *
 * `cooldownMinutes: 0` signifie « une seule fois » et non « à chaque
 * évaluation » : le moteur est réévalué après chaque mouvement, et une règle
 * qui se redéclenche sans limite provoquerait une boucle de rendu.
 */
export type Cooldowns = Record<string, { firedAt: number; severity: Severity }>;

interface Candidate {
  scopeKey: string;
  cooldownMinutes: number;
  title: string;
  body: string;
  severity: Severity;
  actionLabel: string;
  actionTarget: string;
  recipientRoles: Role[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 0, ATTENTION: 1, ACTION_REQUIRED: 2, CRITICAL: 3,
};

export interface RuleInput {
  items: Item[];
  stockOf: (itemId: UUID) => number;
  /** Ventes du jour par article, pour estimer la pression sur le stock prêt. */
  soldToday: Map<UUID, number>;
  cashVariance: number | null;
  wasteCostToday: number;
}

/**
 * Évalue toutes les règles et ne retient que ce qui mérite de réveiller
 * quelqu'un maintenant.
 */
export function evaluateRules(
  input: RuleInput,
  cooldowns: Cooldowns,
  now = Date.now(),
): { notifications: Notification[]; cooldowns: Cooldowns } {
  const candidates: Candidate[] = [];

  for (const item of input.items) {
    if (item.archived) continue;
    const qty = input.stockOf(item.id);
    const health = stockHealth(qty, item);

    /* Stock sous le minimum — on propose la quantité, pas le constat. */
    if (health === 'CRITIQUE' || health === 'RUPTURE') {
      const need = replenishmentNeed(qty, item);
      const isFinished = item.kind === 'FINISHED';
      candidates.push({
        scopeKey: `stock_low:${item.id}`,
        cooldownMinutes: health === 'RUPTURE' ? 15 : 60,
        severity: health === 'RUPTURE' ? 'CRITICAL' : 'ACTION_REQUIRED',
        title:
          health === 'RUPTURE'
            ? `Rupture — ${item.name}`
            : `Stock ${item.name.toLowerCase()} faible`,
        body: `${formatQty(qty, item.unit)} en stock · minimum ${formatQty(item.minimumStock ?? 0, item.unit)}`,
        actionLabel: isFinished
          ? `Lancer un batch de ${Math.ceil(need)}`
          : `Ajouter ${formatQty(need, item.unit)} au bon de commande`,
        actionTarget: isFinished ? '/production/batch' : '/approvisionnement',
        recipientRoles: isFinished ? ['PREPARER', 'MANAGER'] : ['PROCUREMENT', 'MANAGER'],
      });
    }

    /* Produit fini dont le stock ne tiendra pas le rythme de vente observé. */
    if (item.kind === 'FINISHED' && health !== 'RUPTURE') {
      const sold = input.soldToday.get(item.id) ?? 0;
      if (sold >= 3 && qty < sold) {
        candidates.push({
          scopeKey: `demand:${item.id}`,
          cooldownMinutes: 30,
          severity: 'ACTION_REQUIRED',
          title: `Demande forte — ${item.name}`,
          body: `${sold} vendus aujourd'hui, ${Math.floor(qty)} restants au comptoir`,
          actionLabel: `Préparer ${Math.max(10, sold - Math.floor(qty))} unités`,
          actionTarget: '/production/batch',
          recipientRoles: ['PREPARER', 'MANAGER'],
        });
      }
    }
  }

  /* Écart de caisse — jamais un nombre seul, toujours un chemin pour justifier. */
  if (input.cashVariance !== null && Math.abs(input.cashVariance) >= 2000) {
    candidates.push({
      scopeKey: 'cash_variance',
      cooldownMinutes: 0,
      severity: 'CRITICAL',
      title: 'Écart de caisse à justifier',
      body: `${input.cashVariance > 0 ? '+' : ''}${Math.round(input.cashVariance)} FCFA entre l'attendu et le compté`,
      actionLabel: "Ouvrir la clôture",
      actionTarget: '/cloture',
      recipientRoles: ['MANAGER', 'OWNER'],
    });
  }

  /* Pertes cumulées significatives sur la journée. */
  if (input.wasteCostToday >= 10000) {
    candidates.push({
      scopeKey: 'waste_day',
      cooldownMinutes: 360,
      severity: 'ATTENTION',
      title: 'Pertes élevées aujourd’hui',
      body: `${Math.round(input.wasteCostToday)} FCFA de marchandise perdue`,
      actionLabel: 'Analyser les motifs',
      actionTarget: '/stock',
      recipientRoles: ['MANAGER', 'OWNER'],
    });
  }

  /* §45 — cooldown, sauf aggravation de la sévérité. */
  const nextCooldowns: Cooldowns = { ...cooldowns };
  const notifications: Notification[] = [];

  for (const c of candidates) {
    const previous = nextCooldowns[c.scopeKey];
    if (previous) {
      const elapsedMin = (now - previous.firedAt) / 60_000;
      const worsened = SEVERITY_RANK[c.severity] > SEVERITY_RANK[previous.severity];
      const silenced = c.cooldownMinutes === 0 || elapsedMin < c.cooldownMinutes;
      if (!worsened && silenced) continue;
    }

    nextCooldowns[c.scopeKey] = { firedAt: now, severity: c.severity };
    notifications.push({
      id: uuid(),
      title: c.title,
      body: c.body,
      severity: c.severity,
      status: 'UNREAD',
      actionLabel: c.actionLabel,
      actionTarget: c.actionTarget,
      recipientRoles: c.recipientRoles,
      createdAt: new Date(now).toISOString(),
    });
  }

  return { notifications, cooldowns: nextCooldowns };
}
