import { describe, expect, it } from 'vitest';
import { CAPABILITIES, POSTS, POST_PRESET } from '../capabilities';
import { OPERATING_MODES } from '../operating-mode';
import { RESOLUTION_LABEL, VARIANCE_SOURCE_LABEL } from '../variance';
import {
  ITEM_KIND_LABEL, LOCATION_TYPES, MOVEMENT_TYPES, PRODUCTION_MODES,
  SALE_STATUSES, SEVERITIES, SYNC_STATUSES, UNITS,
} from '../types';

/**
 * Le client et le serveur disent-ils la même chose ?
 *
 * Il y a deux représentations des préréglages, et c'est irréductible :
 * l'application doit ouvrir un compte sans réseau (RULE-010), donc `POST_PRESET`
 * est compilé dans le bundle ; le déclencheur `handle_new_user`, lui, ne peut
 * lire que la base. Aucune des deux ne peut interroger l'autre au moment où
 * elle en aurait besoin.
 *
 * Ce qui est réductible, c'est le SILENCE. Deux fois, elles ont divergé sans
 * que rien ne le dise : `MANAGE_SETTINGS` née en 0023 est restée absente du
 * déclencheur jusqu'en 0025. Le symptôme était le pire possible — l'écran
 * s'ouvrait, l'utilisateur agissait, et le serveur refusait à la
 * synchronisation, loin du geste qui l'avait provoqué.
 *
 * Ces tests relisent le SQL réellement versionné et échouent sur la moindre
 * différence. Ils ne rendent pas la divergence impossible ; ils la rendent
 * impossible à ne pas voir.
 */

/*
 * Le SQL est lu par `import.meta.glob` plutôt que par `node:fs` : ce fichier
 * vit dans `src/`, donc sous un tsconfig qui vise le navigateur et ne connaît
 * pas les types de Node. Passer par Vite garde le test dans la même surface
 * typée que le reste de l'application, sans lui ouvrir les globales de Node.
 */
const SOURCES = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const migrations = (): { nom: string; sql: string }[] =>
  Object.entries(SOURCES)
    .map(([chemin, sql]) => ({ nom: chemin.split('/').pop()!, sql }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

/** La dernière migration qui redéclare entièrement la table des préréglages. */
function dernierSnapshot(): { nom: string; sql: string } {
  const porteuses = migrations().filter((m) =>
    m.sql.includes('insert into public.post_capability_preset'),
  );
  expect(
    porteuses.length,
    'Aucune migration ne renseigne post_capability_preset.',
  ).toBeGreaterThan(0);
  return porteuses[porteuses.length - 1];
}

describe('Les préréglages du serveur suivent ceux du client', () => {
  it('reprend la table à zéro à chaque redéclaration', () => {
    // Sans le `delete`, la migration ajoute sans retirer : une capacité qu'on
    // ENLÈVE d'un préréglage resterait accordée aux comptes suivants, et ce
    // test comparerait un état partiel en croyant lire un instantané.
    const { nom, sql } = dernierSnapshot();
    expect(sql, `${nom} doit repartir d'une table vide`).toContain(
      'delete from public.post_capability_preset;',
    );
  });

  it('accorde exactement les mêmes capacités que POST_PRESET, poste par poste', () => {
    const { nom, sql } = dernierSnapshot();

    const seed = sql.slice(sql.indexOf('insert into public.post_capability_preset'));
    const paires = [...seed.matchAll(/\('([A-Z_]+)'\s*,\s*'([A-Z_]+)'\)/g)];
    expect(paires.length, `aucune ligne lisible dans ${nom}`).toBeGreaterThan(0);

    const enBase = new Map<string, Set<string>>();
    for (const [, post, capacite] of paires) {
      if (!enBase.has(post)) enBase.set(post, new Set());
      enBase.get(post)!.add(capacite);
    }

    for (const post of POSTS) {
      const attendu = [...POST_PRESET[post]].sort();
      const trouve = [...(enBase.get(post) ?? new Set<string>())].sort();
      expect(
        trouve,
        `${post} : ${nom} et POST_PRESET ne proposent pas la même chose. `
          + "Régénérez le seed depuis POST_PRESET dans une NOUVELLE migration "
          + '`NNNN_prereglages_*.sql` qui vide puis remplit la table.',
      ).toEqual(attendu);
    }

    // Et aucun poste en trop côté SQL — un poste retiré du client mais laissé
    // en base continuerait d'ouvrir des comptes que plus rien ne décrit.
    expect([...enBase.keys()].sort()).toEqual([...POSTS].sort());
  });

  it('ne propose aucune capacité inconnue du client', () => {
    const { nom, sql } = dernierSnapshot();
    const seed = sql.slice(sql.indexOf('insert into public.post_capability_preset'));
    const citees = new Set([...seed.matchAll(/\('[A-Z_]+'\s*,\s*'([A-Z_]+)'\)/g)].map((m) => m[1]));
    const connues = new Set<string>(CAPABILITIES);
    expect([...citees].filter((c) => !connues.has(c)), nom).toEqual([]);
  });
});

describe("L'enum SQL des capacités suit celui du client", () => {
  /**
   * L'enum tel que les migrations le construisent : création puis ajouts.
   *
   * Le schéma est optionnel dans le motif, et ce n'est pas de la complaisance :
   * 0001 écrit `create type item_kind`, les migrations récentes écrivent
   * `create type public.capability`. Exiger `public.` faisait rendre une liste
   * VIDE pour la moitié des enums — un test qui ne compare rien tout en
   * paraissant vert.
   */
  function enumSql(type: string): string[] {
    const valeurs: string[] = [];
    for (const { sql } of migrations()) {
      const creation = new RegExp(
        `create type (?:public\\.)?${type} as enum\\s*\\(([^)]*)\\)`, 'i',
      ).exec(sql);
      if (creation) {
        // `[A-Za-z_]` et non `[A-Z_]` : `unit_code` vaut « kg », « mL »,
        // « unite ». Le motif en majuscules seules rendait une liste vide pour
        // lui, donc un contrat de plus qui paraissait tenu sans l'être.
        //
        // Et on dédoublonne : une création peut apparaître deux fois, gardée
        // par `if not exists` — 0008 pose `production_mode`, 0011 la repose au
        // cas où. Les deux disent la même chose ; les compter deux fois ferait
        // échouer la comparaison sur un artefact de lecture.
        for (const m of creation[1].matchAll(/'([A-Za-z_]+)'/g)) {
          if (!valeurs.includes(m[1])) valeurs.push(m[1]);
        }
      }
      const ajouts = sql.matchAll(
        new RegExp(`alter type (?:public\\.)?${type} add value[^']*'([A-Za-z_]+)'`, 'gi'),
      );
      for (const m of ajouts) if (!valeurs.includes(m[1])) valeurs.push(m[1]);
    }
    // Un enum introuvable rendrait `[]`, et `[]` comparé à `[]` serait vert
    // sans rien prouver. On refuse le silence plutôt que de s'y fier.
    expect(valeurs.length, `aucune valeur lue pour l'enum ${type}`).toBeGreaterThan(0);
    return valeurs;
  }

  /*
   * Les autres enums partagés. `capability` a dérivé deux fois parce que rien
   * ne les comparait ; il n'y a aucune raison de croire qu'elle était la seule
   * exposée. Chaque ligne ci-dessous est un contrat client/serveur de plus qui
   * cesse de reposer sur la vigilance.
   *
   * Un seul enum reste hors de cette liste, et ce n'est pas un report :
   * `purchase_order_status` n'a AUCUNE contrepartie côté client. Le client ne
   * modélise pas le cycle d'une commande fournisseur — `Purchase` ne porte pas
   * ce statut. Il n'y a donc rien à comparer, et inventer une liste pour
   * satisfaire le test créerait la duplication qu'on cherche à supprimer.
   * Le jour où un écran affichera ce cycle, sa liste vient ici.
   */
  const PARTAGES: [string, readonly string[]][] = [
    /*
     * `capability` remplace le « 26 » qui était écrit en dur dans
     * verify_invariants.sql : un nombre magique ne dit pas LAQUELLE manque, et
     * il faut penser à l'incrémenter — deux occasions de se tromper.
     */
    ['capability', CAPABILITIES],
    ['user_post', POSTS],
    ['operating_mode', OPERATING_MODES],
    ['variance_source', Object.keys(VARIANCE_SOURCE_LABEL)],
    ['variance_resolution', Object.keys(RESOLUTION_LABEL)],
    ['item_kind', Object.keys(ITEM_KIND_LABEL)],
    ['movement_type', MOVEMENT_TYPES],
    ['sync_status', SYNC_STATUSES],
    ['sale_status', SALE_STATUSES],
    ['severity', SEVERITIES],
    /*
     * `Unit` et non `DosingUnit`. Le client accepte « mg » à la SAISIE — on
     * achète au kilo et on dose au milligramme — mais le convertit avant
     * d'enregistrer : « mg » n'est pas et ne doit pas être une valeur de
     * `unit_code`. Comparer `DosingUnit` ferait échouer ce test sur une
     * différence voulue, et la vraie leçon serait perdue.
     */
    ['unit_code', UNITS],
    ['location_type', LOCATION_TYPES],
    ['production_mode', PRODUCTION_MODES],
  ];

  it.each(PARTAGES)('dit la même chose que le client pour %s', (type, cote) => {
    expect(enumSql(type).sort()).toEqual([...cote].sort());
  });

  /**
   * Les enums que le serveur garde pour lui, déclarés un par un.
   *
   * Pas une liste d'exemptions de confort : chaque nom ici est une affirmation
   * qu'AUCUN écran ne connaît ces valeurs. Le jour où l'un d'eux remonte à
   * l'interface, il doit passer dans PARTAGES — et le test ci-dessous force
   * quelqu'un à trancher plutôt qu'à oublier.
   */
  const SERVEUR_SEUL = [
    // Le client ne modélise pas le cycle d'une commande fournisseur :
    // `Purchase` ne porte pas ce statut. Inventer une liste côté client pour
    // satisfaire un test créerait la duplication qu'on cherche à supprimer.
    'purchase_order_status',
  ];

  it('ne laisse aucun enum hors du contrat, ni partagé ni déclaré serveur', () => {
    /*
     * Le test qui rend les précédents durables.
     *
     * Sans lui, un enum créé demain n'est comparé à rien : il est hors
     * couverture PAR DÉFAUT, et personne ne l'apprend. C'est exactement
     * comment `MANAGE_SETTINGS` a pu diverger. Ici, tout enum nouveau fait
     * échouer la suite tant qu'on n'a pas dit ce qu'il est.
     */
    const declares = new Set<string>();
    for (const { sql } of migrations()) {
      for (const m of sql.matchAll(/create type (?:public\.)?([a-z_]+) as enum/gi)) {
        declares.add(m[1]);
      }
    }
    expect(declares.size, 'aucun enum lu dans les migrations').toBeGreaterThan(0);

    /*
     * Un type retiré depuis n'a pas à figurer au contrat. `user_role` a existé
     * jusqu'à 0009, qui l'a remplacé par `user_post` PUIS supprimé — le laisser
     * exiger une liste côté client demanderait de maintenir un vocabulaire que
     * la base ne connaît plus. On lit les suppressions plutôt que d'entretenir
     * une liste d'exceptions qui, elle, dériverait.
     */
    for (const { sql } of migrations()) {
      for (const m of sql.matchAll(/drop type (?:if exists )?(?:public\.)?([a-z_]+)/gi)) {
        declares.delete(m[1]);
      }
    }

    const couverts = new Set([...PARTAGES.map(([t]) => t), ...SERVEUR_SEUL]);
    const orphelins = [...declares].filter((t) => !couverts.has(t)).sort();

    expect(
      orphelins,
      "Enum(s) sans contrat. Ajoutez chacun à PARTAGES avec sa liste côté "
        + "client, ou à SERVEUR_SEUL si l'interface ne le connaît vraiment pas.",
    ).toEqual([]);
  });
});
