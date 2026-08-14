/**
 * La coque ne change pas de forme.
 *
 * L'ancienne navigation additionnait les menus de chaque rôle : un polyvalent
 * se retrouvait avec huit onglets, et l'application devenait impossible à
 * apprendre. Ici la barre a toujours cinq emplacements, dans le même ordre, au
 * même endroit. Seul leur contenu dépend des capacités.
 *
 * Le troisième emplacement est fixe et central : « Déclarer ». C'est le point
 * d'entrée unique de toute déclaration. Une personne qui tient trois capacités
 * et une qui en tient quinze appuient au même endroit.
 */

import type { Capability } from '../domain/capabilities';
import type { Feature, IconType } from '../features/registry';
import { featuresFor, homeFor } from '../features/registry';
import { IconAlert, IconMore, IconPlus, IconUser } from '../design-system/icons';

export interface NavItem {
  to: string;
  label: string;
  Icon: IconType;
  /** L'emplacement central : il ouvre le tiroir, il ne navigue pas. */
  opensSheet?: boolean;
  /** Le dernier emplacement : il ouvre le menu, il ne navigue pas. */
  opensMenu?: boolean;
  /** Correspondance de route : l'onglet reste actif sur les sous-écrans. */
  match?: string;
}

const ALERTS: NavItem = { to: '/alertes', label: 'Alertes', Icon: IconAlert, match: '/alertes' };
const DECLARE: NavItem = { to: '#declarer', label: 'Déclarer', Icon: IconPlus, opensSheet: true };
const PROFILE: NavItem = { to: '/moi', label: 'Moi', Icon: IconUser, match: '/moi' };

/** Nombre de features que la barre peut porter sans devenir illisible. */
const TAB_FEATURE_SLOTS = 3;

function navItemOf(f: Feature, short = true): NavItem {
  return { to: f.home, label: short ? f.short : f.label, Icon: f.Icon, match: f.home };
}

/**
 * Cinq emplacements : deux features, le tiroir, une troisième feature, le menu.
 *
 * La barre ne porte que trois features — au-delà, les libellés deviennent
 * illisibles sur un téléphone. Le dernier emplacement n'est donc PAS le profil
 * mais un menu : c'est lui qui rend joignable tout ce qui ne tient pas dans la
 * barre. Sans ça, quelqu'un qui tient six features n'en atteignait que trois,
 * et les trois autres n'existaient tout simplement pas sur mobile.
 *
 * On complète avec les alertes quand la personne tient moins de trois features
 * — un emplacement vide serait pire qu'une destination de repli utile.
 */
export function tabsFor(capabilities: readonly Capability[]): NavItem[] {
  const features = featuresFor(capabilities);
  const slots = features.slice(0, TAB_FEATURE_SLOTS).map((f) => navItemOf(f));

  const filled = [...slots];
  while (filled.length < TAB_FEATURE_SLOTS) filled.push(ALERTS);

  return [
    filled[0],
    filled[1],
    DECLARE,
    filled[2],
    { to: '#menu', label: 'Menu', Icon: IconMore, opensMenu: true },
  ];
}

/**
 * Ce que la barre n'a pas pu porter.
 *
 * C'est le contenu du menu : les features au-delà de la troisième, les alertes
 * si elles ne sont pas déjà un onglet, et le profil. Rien de ce à quoi la
 * personne a droit ne doit rester hors d'atteinte.
 */
export function overflowFor(capabilities: readonly Capability[]): NavItem[] {
  const features = featuresFor(capabilities);
  const rest = features.slice(TAB_FEATURE_SLOTS).map((f) => navItemOf(f, false));
  const alertsShown = features.length < TAB_FEATURE_SLOTS;
  return [...rest, ...(alertsShown ? [] : [ALERTS]), PROFILE];
}

/**
 * Le rail de bureau liste les features et les alertes — pas le profil.
 *
 * Il figurait ici ET en pied de rail : le même prénom apparaissait deux fois
 * dans la même colonne, à trente centimètres d'écart. Le pied gagne, parce
 * qu'il porte déjà le poste, le nombre d'accès et la déconnexion.
 *
 * Le rail se replie (voir `AppShell`), mais son contenu ne change pas en se
 * repliant : replier masque les libellés, jamais des destinations. Une
 * navigation qui perd des entrées selon sa largeur n'est plus apprenable.
 */
export function railFor(capabilities: readonly Capability[]): NavItem[] {
  const features = featuresFor(capabilities).map((f) => ({
    to: f.home, label: f.label, Icon: f.Icon, match: f.home,
  }));
  return [...features, ALERTS];
}

export { homeFor };
