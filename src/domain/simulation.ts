/**
 * Le bac à sable de simulation.
 *
 * Simuler une journée entière — ouvrir la caisse, réceptionner, vendre,
 * annuler, perdre, dépenser, compter, clôturer — sans que rien n'entre dans
 * les chiffres de la maison. Le dispositif n'est pas un mode de
 * l'application : c'est une SECONDE ORGANISATION, montée par
 * `scripts/simulation-seed.sql` et effacée par `scripts/simulation-purge.sql`.
 *
 * Ce choix tient à ce que le schéma faisait déjà : chaque table porte un
 * `organization_id`, chaque politique RLS filtre sur `current_org_id()`, et
 * toutes les clés étrangères vers `organizations` cascadent. Il en découle
 * deux propriétés qu'aucun drapeau posé sur les lignes n'aurait données :
 *
 * 1. L'étanchéité est tenue par PostgreSQL, pas par notre vigilance. Un
 *    compte de simulation ne peut pas écrire dans la maison réelle — RLS
 *    refuse, quelle que soit l'erreur commise au-dessus.
 * 2. La fin de simulation tient en un prédicat : on supprime l'organisation,
 *    la cascade emporte le reste. Aucune table ne peut être oubliée, et aucun
 *    rapport ne risque d'oublier un `where not is_simulation`.
 *
 * Ce module ne contient donc qu'une constante et deux lectures. Tout le reste
 * est du SQL et de la RLS.
 */

import type { UUID } from './types';

/**
 * L'organisation de simulation, telle que `simulation-seed.sql` la crée.
 *
 * Famille d'identifiants en 9, en écho au schéma réel — la maison est en 1,
 * son site en 2, ses emplacements en 3, ses fournisseurs en 4. Un 9 en tête
 * se repère à l'œil nu dans une requête de diagnostic comme dans un journal.
 */
export const SIMULATION_ORG_ID: UUID = '99999999-9999-9999-9999-999999999999';

/** Vrai quand l'organisation donnée est le bac à sable. */
export function isSimulation(organizationId: UUID | null | undefined): boolean {
  return organizationId === SIMULATION_ORG_ID;
}

/**
 * Ce que le bandeau annonce, et ce que la personne doit en retenir.
 *
 * Le texte est ici, et pas dans l'écran, parce qu'il est la contrepartie
 * exacte de la constante ci-dessus : le jour où le dispositif change, les
 * deux changent ensemble.
 */
export const SIMULATION_NOTICE = {
  title: 'Mode simulation',
  body: "Rien de ce que vous faites ici n'entre dans les chiffres de la maison. Tout sera effacé à la fin de la simulation.",
} as const;
