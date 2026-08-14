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
import type { IconType } from '../features/registry';
import { featuresFor, homeFor } from '../features/registry';
import { IconAlert, IconMore, IconPlus } from '../design-system/icons';

export interface NavItem {
  to: string;
  label: string;
  Icon: IconType;
  /** L'emplacement central : il ouvre le tiroir, il ne navigue pas. */
  opensSheet?: boolean;
  /** Correspondance de route : l'onglet reste actif sur les sous-écrans. */
  match?: string;
}

const ALERTS: NavItem = { to: '/alertes', label: 'Alertes', Icon: IconAlert, match: '/alertes' };
const DECLARE: NavItem = { to: '#declarer', label: 'Déclarer', Icon: IconPlus, opensSheet: true };

/**
 * Cinq emplacements : deux features, le tiroir, une troisième feature, le profil.
 *
 * On complète avec les alertes quand la personne tient moins de trois features
 * — un emplacement vide serait pire qu'une destination de repli utile.
 */
export function tabsFor(capabilities: readonly Capability[], firstName: string): NavItem[] {
  const features = featuresFor(capabilities);
  const slots: NavItem[] = features.map((f) => ({
    to: f.home, label: f.short, Icon: f.Icon, match: f.home,
  }));

  const [first, second, third] = slots;
  const filled = [first, second, third].filter(Boolean) as NavItem[];
  while (filled.length < 3) filled.push(ALERTS);

  return [
    filled[0],
    filled[1],
    DECLARE,
    filled[2],
    { to: '/moi', label: firstName || 'Moi', Icon: IconMore, match: '/moi' },
  ];
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
