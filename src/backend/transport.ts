import type { DomainEvent, SaleLine, Unit, UUID } from '../domain/types';
import type { Transport, TransportOutcome } from '../store/outbox';
import { supabase } from './supabase';
import { asUuid } from './mappers';

/**
 * Transport de synchronisation vers Supabase.
 *
 * Il n'envoie JAMAIS de niveaux de stock — uniquement des faits datés et
 * identifiés. Le serveur reconstruit l'état (§57), ce qui autorise plusieurs
 * appareils hors ligne en parallèle.
 *
 * L'idempotence repose sur `event.id`, généré côté client avant toute
 * connexion : chaque fonction transactionnelle commence par vérifier si cet
 * identifiant a déjà produit une transaction, et renvoie l'existante le cas
 * échéant. Un retry réseau ne peut donc pas dupliquer une vente.
 */

/** Fonctions PostgreSQL correspondant à chaque type d'événement. */
const RPC_BY_EVENT: Partial<Record<DomainEvent['eventType'], string>> = {
  SALE_COMPLETED: 'complete_sale',
  SALE_CANCELLED: 'void_sale',
  GOODS_RECEIVED: 'receive_goods',
  WASTE_RECORDED: 'record_waste',
  STOCK_TRANSFERRED: 'transfer_stock',
  STOCK_COUNTED: 'apply_inventory_count',
  BATCH_COMPLETED: 'complete_batch',
  EXPENSE_RECORDED: 'record_expense',
  CASH_SESSION_OPENED: 'open_cash_session',
  CASH_SESSION_CLOSED: 'close_cash_session',
  /*
   * Le nom porte mal son usage : cet événement sert à la RÉSOLUTION d'un
   * écart, pas à sa détection — la détection n'a jamais eu son propre
   * événement, elle naît en silence à l'intérieur d'une autre transaction
   * (compte d'inventaire, clôture, batch, ou maintenant une dépense
   * empruntée). On ne renomme pas ce vocabulaire déjà en place ; on le câble.
   */
  STOCK_VARIANCE_DETECTED: 'resolve_variance',
  CAPABILITY_GRANTED: 'grant_capability',
  CAPABILITY_REVOKED: 'revoke_capability',
  /* Le régime d'exploitation : un réglage de site, mais envoyé comme un fait
     daté — il change ce que l'application exige de toute l'équipe, et le
     journal doit pouvoir dire qui l'a changé et quand. */
  OPERATING_MODE_SET: 'set_operating_mode',
};

/*
 * Les trois types restants — PAYMENT_RECEIVED, PURCHASE_REQUESTED,
 * PURCHASE_ORDER_APPROVED — n'ont volontairement pas de transaction dédiée
 * ici. Le paiement est déjà porté par `complete_sale` (l'écrire deux fois
 * doublerait l'encaissement) ; les deux autres attendent l'écran d'approbation
 * d'achat. Ils restent journalisés dans `domain_events`, ce qui est correct
 * pour un fait qui n'a pas encore de projection.
 */

export const supabaseTransport: Transport = async (events) => {
  const outcome: TransportOutcome = { acceptedIds: [], failedIds: [], conflictIds: [] };
  if (!supabase) {
    // Sans client, rien n'est parti : ces événements restent réessayables.
    outcome.failedIds = events.map((e) => e.id);
    return outcome;
  }

  // Séquentiel et volontairement conservateur : l'ordre des faits compte, et
  // un échec ne doit pas emporter les événements suivants.
  for (const event of events) {
    const rpc = RPC_BY_EVENT[event.eventType];
    try {
      if (event.eventType === 'CATALOG_ITEM_SAVED') {
        /*
         * Le catalogue n'a pas de fonction transactionnelle : il n'a rien à
         * rejouer ni à recalculer, et RLS le protège déjà (`items_update`
         * exige MANAGE_CATALOG dans l'organisation). On écrit donc la ligne
         * directement. L'idempotence tient à la clé primaire : renvoyer deux
         * fois la même fiche produit exactement le même article.
         */
        const row = (event.payload as { row?: Record<string, unknown> }).row;
        if (!row) throw new Error('CATALOG_ITEM_SAVED sans ligne à écrire');
        const { error } = await supabase.from('items').upsert(row, { onConflict: 'id' });
        if (error) throw error;
      } else if (event.eventType === 'RECIPE_SAVED') {
        /*
         * Trois tables, dans l'ordre où les clés étrangères l'exigent : la
         * recette, puis sa version, puis les ingrédients. `current_version_id`
         * vient en dernier — il désigne une version qui n'existe pas encore au
         * moment où la recette est écrite.
         *
         * L'ensemble n'est pas transactionnel, et c'est acceptable ici : tout
         * est écrit par clé primaire, donc rejouable à l'identique. Un échec
         * en cours de route laisse l'événement dans la file, et la tentative
         * suivante repasse les quatre écritures. Les écrans savent déjà lire
         * une recette dont la version manque encore.
         */
        const p = event.payload as {
          recipe?: Record<string, unknown>;
          version?: Record<string, unknown>;
          ingredients?: Record<string, unknown>[];
        };
        if (!p.recipe || !p.version) throw new Error('RECIPE_SAVED incomplet');

        const recipeWrite = await supabase.from('recipes').upsert(p.recipe, { onConflict: 'id' });
        if (recipeWrite.error) throw recipeWrite.error;

        const versionWrite = await supabase.from('recipe_versions').upsert(p.version, { onConflict: 'id' });
        if (versionWrite.error) throw versionWrite.error;

        /* Les ingrédients d'une version sont réécrits en bloc : une version
           est immuable une fois gelée, et l'éditeur en crée une nouvelle à
           chaque enregistrement — il n'y a donc rien à fusionner. */
        const versionId = p.version.id as string;
        const wipe = await supabase.from('recipe_ingredients').delete().eq('recipe_version_id', versionId);
        if (wipe.error) throw wipe.error;

        if (p.ingredients?.length) {
          const lines = await supabase.from('recipe_ingredients').insert(p.ingredients);
          if (lines.error) throw lines.error;
        }

        const link = await supabase.from('recipes')
          .update({ current_version_id: versionId })
          .eq('id', p.recipe.id as string);
        if (link.error) throw link.error;
      } else if (rpc) {
        const { error } = await supabase.rpc(rpc, buildArgs(event));
        if (error) throw error;
      } else {
        // Événements sans transaction dédiée : journalisés tels quels.
        // `ignoreDuplicates` porte ici l'idempotence — la clé primaire est
        // l'identifiant client, un renvoi ne produit donc pas de doublon.
        const { error } = await supabase.from('domain_events').upsert(
          {
            id: event.id,
            organization_id: event.organizationId,
            site_id: event.siteId,
            event_type: event.eventType,
            entity_type: event.entityType,
            entity_id: event.entityId,
            actor_user_id: event.actorUserId,
            device_id: event.deviceId,
            payload: event.payload,
            created_at_local: event.createdAtLocal,
          },
          { onConflict: 'id', ignoreDuplicates: true },
        );
        if (error) throw error;
      }
      outcome.acceptedIds.push(event.id);
    } catch (error) {
      route(classify(error), event.id, outcome);
    }
  }

  return outcome;
};

function route(verdict: Verdict, id: UUID, outcome: TransportOutcome): void {
  if (verdict === 'ACCEPTED') outcome.acceptedIds.push(id);
  else if (verdict === 'CONFLICT') outcome.conflictIds!.push(id);
  else outcome.failedIds.push(id);
}

/* --------------------------------------------------- Lecture des erreurs */

export type Verdict = 'ACCEPTED' | 'FAILED' | 'CONFLICT';

/**
 * Codes PostgreSQL qui expriment un REFUS, pas une panne. Les rejouer donnera
 * exactement le même refus : l'événement doit sortir de la file et devenir
 * visible, pas tourner en boucle.
 */
const PERMANENT = new Set([
  'P0001', // raise exception — règle métier (« Rôle % non autorisé », « Vente introuvable »)
  '42501', // droits insuffisants / RLS
  '42883', // fonction inexistante avec cette signature
  '22P02', // texte invalide pour le type — typiquement un identifiant qui n'est pas un UUID
  '22007', // date invalide
  '23502', // colonne NOT NULL restée vide
  '23503', // clé étrangère absente
  '23514', // contrainte CHECK violée
  /*
   * Erreurs de schéma : la colonne ou la table n'existe pas. Aucun réessai ne
   * peut les résoudre, et les laisser en « à réessayer » est bien pire qu'un
   * simple envoi perdu — la file ne se vide jamais, et une file non vide
   * empêche l'hydratation de tourner. Un seul événement mal formé gelait
   * ainsi toute la synchronisation de l'appareil, en silence.
   */
  '42703', // colonne inexistante
  '42P01', // table inexistante
]);

/** L'événement était déjà là : c'est exactement ce que l'idempotence promet. */
const ALREADY_APPLIED = new Set(['23505']); // unique_violation (clé primaire = id client)

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? '');
}

/**
 * Verdict à partir de l'erreur renvoyée par Supabase.
 *
 * Le doute profite à la file : une erreur qu'on ne sait pas lire est classée
 * réessayable. Perdre un fait saisi au comptoir est bien pire que d'occuper
 * une ligne d'attente une minute de plus.
 */
export function classify(error: unknown): Verdict {
  const code = codeOf(error);
  if (ALREADY_APPLIED.has(code)) return 'ACCEPTED';
  if (PERMANENT.has(code)) return 'CONFLICT';

  // PGRSTxxx : PostgREST lui-même (cache de schéma périmé, requête malformée).
  // Le cache se rafraîchit tout seul : on laisse une chance au réessai.
  if (code.startsWith('PGRST')) return 'FAILED';

  const message = messageOf(error).toLowerCase();
  if (message.includes('violates row-level security')) return 'CONFLICT';
  if (message.includes('invalid input syntax')) return 'CONFLICT';

  return 'FAILED';
}

/* --------------------------------------------- Traduction des arguments */

/**
 * Les fonctions PostgreSQL lisent leurs lignes en `snake_case`
 * (`item_id`, `unit_price`, `unit_cost`) alors que le domaine les écrit en
 * `camelCase`. Sans cette traduction, `(ligne->>'unit_price')` vaut NULL,
 * le total devient NULL et l'insertion casse sur une contrainte NOT NULL —
 * c'est-à-dire une vente qui ne parvient jamais en base.
 */
function saleLinesForRpc(lines: SaleLine[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    unit_cost: line.unitCost,
  }));
}

interface ReceiptLine { itemId: UUID; quantity: number; unitPrice: number; unit?: Unit }

function receiptLinesForRpc(lines: ReceiptLine[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    quantity: line.quantity,
    // `unit` alimente une colonne `unit_code` NOT NULL : jamais d'omission.
    unit: line.unit ?? 'unite',
    unit_price: line.unitPrice,
  }));
}

interface ConsumptionLine { itemId: UUID; quantity: number; unit?: Unit; locationId?: UUID }

/**
 * Les ingrédients consommés par un lot.
 *
 * Les quantités partent en valeur absolue : côté client ce sont des mouvements
 * négatifs (la sortie de stock est déjà signée), côté serveur `complete_batch`
 * applique lui-même le signe. Envoyer un négatif ferait rentrer les
 * ingrédients au lieu de les sortir.
 *
 * `location_id` voyage avec la ligne, et c'est indispensable :
 * `stock_movements.location_id` est NOT NULL, et la fonction lisait
 * `(line->>'location_id')` d'une ligne qui ne l'a jamais porté. Chaque lot
 * ayant consommé quelque chose échouait donc en base sur un `23502` — code
 * que `classify` traite en `FAILED`, donc réessayé indéfiniment. Une file qui
 * ne se vide jamais bloque en plus l'hydratation : un seul batch suffisait à
 * geler toute la synchronisation de l'appareil, en silence.
 *
 * L'emplacement est celui que le client a réellement choisi ingrédient par
 * ingrédient — le lait sort du frigo, les gobelets de la réserve — et non
 * l'emplacement de destination du lot.
 */
function consumptionForRpc(lines: ConsumptionLine[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    quantity: Math.abs(line.quantity),
    unit: line.unit ?? 'unite',
    location_id: line.locationId ?? null,
  }));
}

/** Traduit un événement local en arguments de sa fonction PostgreSQL. */
export function buildArgs(event: DomainEvent): Record<string, unknown> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case 'SALE_COMPLETED':
      return {
        p_event_id: event.id,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        // Une caisse de démonstration n'existe pas côté serveur : mieux vaut
        // une vente sans session qu'une vente rejetée sur un cast d'UUID.
        p_cash_session_id: asUuid(payload.cashSessionId),
        p_payment_method: payload.paymentMethod ?? 'CASH',
        p_amount_received: payload.amountReceived ?? 0,
        p_lines: saleLinesForRpc((payload.lines ?? []) as SaleLine[]),
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };
    case 'SALE_CANCELLED':
      return { p_event_id: event.id, p_sale_id: event.entityId, p_reason: payload.reason };
    case 'GOODS_RECEIVED':
      return {
        p_event_id: event.id,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        p_supplier_id: payload.supplierId,
        p_lines: receiptLinesForRpc((payload.lines ?? []) as ReceiptLine[]),
        p_transport_cost: payload.transportCost ?? 0,
        p_payment_method: payload.paymentMethod ?? 'CASH',
      };

    case 'WASTE_RECORDED':
      return {
        p_event_id: event.id,
        p_waste_id: event.entityId,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        p_item_id: payload.itemId,
        p_quantity: payload.quantity,
        p_unit: payload.unit ?? 'unite',
        p_cost: payload.cost ?? 0,
        p_reason: payload.reason,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'STOCK_TRANSFERRED':
      return {
        p_event_id: event.id,
        p_transfer_id: event.entityId,
        p_site_id: event.siteId,
        p_item_id: payload.itemId,
        p_from_location_id: payload.from,
        p_to_location_id: payload.to,
        p_quantity: payload.quantity,
        p_unit: payload.unit ?? 'unite',
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'STOCK_COUNTED':
      return {
        p_event_id: event.id,
        p_count_id: payload.countId ?? event.entityId,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        p_item_id: payload.itemId,
        p_unit: payload.unit ?? 'unite',
        p_theoretical: payload.theoretical,
        p_counted: payload.counted,
        p_delta: payload.delta,
        p_reason: payload.reason,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'BATCH_COMPLETED':
      return {
        p_event_id: event.id,
        p_batch_id: payload.batchId ?? event.entityId,
        p_site_id: event.siteId,
        p_code: payload.code,
        p_item_id: payload.itemId,
        /* Un lot déclaré sans recette en envoie l'absence, pas une chaîne
           vide : `''::uuid` est une erreur de cast, et l'événement resterait
           dans la file à échouer indéfiniment. */
        p_recipe_version_id: asUuid(payload.recipeVersionId),
        p_location_id: payload.locationId,
        p_planned: payload.planned,
        p_produced: payload.produced,
        p_loss: payload.loss ?? 0,
        p_consumption: consumptionForRpc(
          (payload.consumption ?? []) as ConsumptionLine[],
        ),
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'OPERATING_MODE_SET':
      return {
        p_event_id: event.id,
        p_site_id: event.siteId,
        p_mode: payload.mode,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'EXPENSE_RECORDED':
      return {
        p_event_id: event.id,
        p_expense_id: payload.expenseId ?? event.entityId,
        p_site_id: event.siteId,
        p_amount: payload.amount,
        p_category: payload.category,
        p_description: payload.description,
        // Une dépense sans fournisseur est courante : `asUuid` évite qu'une
        // chaîne vide parte casser un cast d'UUID côté serveur.
        p_supplier_id: asUuid(payload.supplierId),
        p_payment_method: payload.paymentMethod ?? 'CASH',
        // Présents seulement si la dépense a ouvert une dette (emprunt pour
        // couvrir un tiroir insuffisant) — absents sinon, ce que `record_expense`
        // lit comme « pas d'écart à ouvrir ».
        p_variance_id: payload.varianceId ?? null,
        p_variance_amount: payload.varianceAmount ?? 0,
        p_variance_subject: payload.varianceSubject ?? null,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'CASH_SESSION_OPENED':
      return {
        p_event_id: event.id,
        p_cash_session_id: payload.cashSessionId ?? event.entityId,
        p_site_id: event.siteId,
        p_shift_number: payload.shiftNumber,
        p_opening_cash: payload.openingCash ?? 0,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'CASH_SESSION_CLOSED':
      return {
        p_event_id: event.id,
        p_cash_session_id: payload.cashSessionId ?? event.entityId,
        p_site_id: event.siteId,
        p_shift_number: payload.shiftNumber,
        p_opening_cash: payload.openingCash ?? 0,
        p_expected: payload.expected,
        p_counted_cash: payload.countedCash,
        p_variance: payload.variance,
        p_reason: payload.reason ?? null,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    case 'STOCK_VARIANCE_DETECTED':
      return {
        p_event_id: event.id,
        p_variance_id: event.entityId,
        p_site_id: payload.siteId ?? event.siteId,
        p_source: payload.source,
        p_reference_id: payload.referenceId,
        p_subject: payload.subject,
        p_theoretical: payload.theoretical ?? 0,
        p_declared: payload.declared ?? 0,
        p_delta: payload.delta ?? 0,
        p_amount: payload.amount ?? 0,
        p_resolution: payload.resolution,
        p_note: payload.note ?? null,
        p_detected_at: payload.detectedAt ?? null,
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };

    /*
     * `grant_capability`/`revoke_capability` n'ont pas de `p_event_id` : leur
     * idempotence tient à leur propre logique (accorder un droit déjà actif
     * renvoie l'accord existant plutôt que d'en ouvrir un second), pas au
     * rejeu de l'identifiant client comme les autres transactions.
     */
    case 'CAPABILITY_GRANTED':
    case 'CAPABILITY_REVOKED':
      return { p_user_id: payload.userId, p_capability: payload.capability };

    default:
      return {};
  }
}
