import { describe, expect, it } from 'vitest';
import { CAPABILITIES, POSTS, POST_PRESET } from '../capabilities';

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
  /** L'enum tel que les migrations le construisent : création puis ajouts. */
  function enumSql(type: string): string[] {
    const valeurs: string[] = [];
    for (const { sql } of migrations()) {
      const creation = new RegExp(`create type public\\.${type} as enum\\s*\\(([^)]*)\\)`, 'i')
        .exec(sql);
      if (creation) {
        for (const m of creation[1].matchAll(/'([A-Z_]+)'/g)) valeurs.push(m[1]);
      }
      const ajouts = sql.matchAll(
        new RegExp(`alter type public\\.${type} add value[^']*'([A-Z_]+)'`, 'gi'),
      );
      for (const m of ajouts) if (!valeurs.includes(m[1])) valeurs.push(m[1]);
    }
    return valeurs;
  }

  it("connaît exactement les capacités de CAPABILITIES", () => {
    // C'est ce contrôle qui remplace le « 26 » écrit en dur dans
    // verify_invariants.sql : un nombre magique ne dit pas LAQUELLE manque, et
    // il faut penser à l'incrémenter — deux occasions de se tromper.
    expect(enumSql('capability').sort()).toEqual([...CAPABILITIES].sort());
  });

  it('connaît exactement les postes de POSTS', () => {
    expect(enumSql('user_post').sort()).toEqual([...POSTS].sort());
  });
});
