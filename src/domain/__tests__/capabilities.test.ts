import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES, CAPABILITY_FEATURE, CAPABILITY_LABEL, POSTS, POST_PRESET,
  backfillGrants, capabilitiesOfFeature, effectiveCapabilities, holds, visibleFeatures,
  type CapabilityGrant,
} from '../capabilities';
import {
  FEATURES, capabilitiesByFeature, featuresFor, homeFor, operationsFor,
} from '../../features/registry';

const grant = (
  userId: string, capability: (typeof CAPABILITIES)[number], revokedAt?: string,
): CapabilityGrant => ({
  id: `g-${userId}-${capability}`,
  userId,
  capability,
  grantedBy: 'u-bouna',
  grantedByName: 'Bouna',
  grantedAt: '2026-08-01T08:00:00Z',
  ...(revokedAt ? { revokedAt, revokedBy: 'u-bouna', revokedByName: 'Bouna' } : {}),
});

describe('Le poste propose, il ne décide pas', () => {
  it('donne à chaque poste un préréglage non vide', () => {
    for (const post of POSTS) {
      expect(POST_PRESET[post].length, post).toBeGreaterThan(0);
    }
  });

  it("n'accorde tout qu'au propriétaire", () => {
    expect(POST_PRESET.OWNER).toHaveLength(CAPABILITIES.length);
    for (const post of POSTS.filter((p) => p !== 'OWNER')) {
      expect(POST_PRESET[post].length, post).toBeLessThan(CAPABILITIES.length);
    }
  });

  it('réserve la réouverture d\'une journée au propriétaire', () => {
    // RULE-009 — un manager qui pourrait rouvrir sa propre journée viderait
    // le verrouillage de son sens.
    for (const post of POSTS.filter((p) => p !== 'OWNER')) {
      expect(POST_PRESET[post], post).not.toContain('REOPEN_DAY');
    }
  });

  it('ne fige aucune capacité dans un poste : un vendeur peut réceptionner', () => {
    const grants = [
      ...POST_PRESET.SELLER.map((c) => grant('u-ibou', c)),
      grant('u-ibou', 'RECEIVE_GOODS'),
    ];
    const effective = effectiveCapabilities(grants, 'u-ibou');
    expect(holds(effective, 'RECEIVE_GOODS')).toBe(true);
    expect(holds(effective, 'SELL')).toBe(true);
    // Et il reste vendeur : le poste n'a pas bougé.
    expect(effective).not.toContain('MANAGE_TEAM');
  });
});

describe("Un accord est un fait daté, pas une case cochée", () => {
  it('cesse de donner le droit une fois révoqué', () => {
    const grants = [grant('u-ibou', 'RECEIVE_GOODS', '2026-08-12T10:00:00Z')];
    expect(effectiveCapabilities(grants, 'u-ibou')).toEqual([]);
  });

  it("garde la ligne révoquée : l'historique doit rester lisible", () => {
    const grants = [grant('u-ibou', 'RECEIVE_GOODS', '2026-08-12T10:00:00Z')];
    expect(grants[0].revokedAt).toBeDefined();
    expect(grants[0].grantedByName).toBe('Bouna');
  });

  it("n'accorde rien à quelqu'un d'autre", () => {
    const grants = [grant('u-ibou', 'SELL')];
    expect(effectiveCapabilities(grants, 'u-maty')).toEqual([]);
  });

  it('dédoublonne un droit accordé deux fois', () => {
    const grants = [grant('u-ibou', 'SELL'), { ...grant('u-ibou', 'SELL'), id: 'g-bis' }];
    expect(effectiveCapabilities(grants, 'u-ibou')).toEqual(['SELL']);
  });
});

describe('Le registre des features est la seule source de navigation', () => {
  it('rattache chaque capacité à une feature et à un libellé', () => {
    for (const c of CAPABILITIES) {
      expect(CAPABILITY_LABEL[c], c).toBeTruthy();
      expect(CAPABILITY_FEATURE[c], c).toBeTruthy();
    }
  });

  it('rend chaque capacité délégable depuis l\'écran Équipe', () => {
    // L'écran Équipe parcourt les opérations du registre. Une capacité sans
    // opération serait impossible à accorder : un droit inaccessible.
    const covered = new Set(FEATURES.flatMap((f) => f.operations).map((o) => o.requires));
    const orphans = CAPABILITIES.filter((c) => !covered.has(c));
    expect(orphans).toEqual([]);
  });

  it('range chaque opération dans la feature de sa capacité', () => {
    for (const feature of FEATURES) {
      for (const op of feature.operations) {
        // Une exception assumée : ouvrir la caisse se déclare depuis la vente,
        // mais la caisse appartient à la finance.
        if (op.id === 'vente.caisse') continue;
        expect(CAPABILITY_FEATURE[op.requires], op.id).toBe(feature.id);
      }
    }
  });

  it("n'affiche jamais deux fois le même droit", () => {
    // Deux opérations peuvent reposer sur la même capacité — consulter les
    // ventes et en enregistrer une demandent toutes deux SELL. Les écrans qui
    // parlent de DROITS doivent dédoublonner, sinon le manager voit deux cases
    // pour un seul droit et en cocher une décoche l'autre.
    const rows = capabilitiesByFeature().flatMap((g) => g.rows.map((r) => r.capability));
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows).toHaveLength(CAPABILITIES.length);
  });

  it("n'ouvre aucune feature à qui n'a aucune capacité", () => {
    expect(featuresFor([])).toEqual([]);
    expect(operationsFor([])).toEqual([]);
    expect(visibleFeatures([])).toEqual([]);
    // Personne n'atterrit sur une page vide.
    expect(homeFor([])).toBe('/moi');
  });

  it('ouvre exactement ce que les capacités permettent', () => {
    const seller = POST_PRESET.SELLER;
    const ops = operationsFor(seller);
    expect(ops.every((o) => seller.includes(o.requires))).toBe(true);
    expect(ops.some((o) => o.requires === 'RECEIVE_GOODS')).toBe(false);
    expect(capabilitiesOfFeature(seller, 'PILOTAGE')).toEqual([]);
  });

  it('envoie le manager sur son tableau de bord, le vendeur sur sa vente', () => {
    expect(homeFor(POST_PRESET.MANAGER)).toBe('/pilotage');
    expect(homeFor(POST_PRESET.SELLER)).toBe('/vente');
    expect(homeFor(POST_PRESET.PREPARER)).toBe('/production');
  });
});


/**
 * Une capacité née après un cache local.
 *
 * `MANAGE_SETTINGS` en est la première : elle n'apparaissait dans aucun accord
 * enregistré, donc l'écran qu'elle garde devenait inaccessible à tout le monde
 * — propriétaire compris — et personne ne pouvait se l'accorder faute de la
 * détenir. Le rattrapage doit être étroit : il répare l'oubli, il ne réécrit
 * pas l'histoire des délégations.
 */
describe('rattrapage des capacités nouvelles', () => {
  const AT = '2026-08-17T08:00:00.000Z';
  const owner = { id: 'u-1', name: 'Bouna', post: 'OWNER' as const };
  const seller = { id: 'u-2', name: 'Awa', post: 'SELLER' as const };

  it("accorde une capacité que le journal n'a jamais vue", () => {
    const missing = backfillGrants([], [owner], AT);
    expect(missing.map((g) => g.capability)).toContain('MANAGE_SETTINGS');
  });

  it('ne ressuscite JAMAIS une capacité révoquée', () => {
    /* Retirer un droit est un fait daté. Aucune mise à jour ne le défait. */
    const revoked: CapabilityGrant = {
      id: 'g1', userId: owner.id, capability: 'MANAGE_SETTINGS',
      grantedBy: owner.id, grantedByName: 'Bouna', grantedAt: AT,
      revokedBy: owner.id, revokedByName: 'Bouna', revokedAt: AT,
    };
    const missing = backfillGrants([revoked], [owner], AT);
    expect(missing.map((g) => g.capability)).not.toContain('MANAGE_SETTINGS');
  });

  it('ne double pas un accord déjà actif', () => {
    const existing: CapabilityGrant = {
      id: 'g2', userId: owner.id, capability: 'MANAGE_SETTINGS',
      grantedBy: owner.id, grantedByName: 'Bouna', grantedAt: AT,
    };
    const missing = backfillGrants([existing], [owner], AT);
    expect(missing.filter((g) => g.capability === 'MANAGE_SETTINGS')).toHaveLength(0);
  });

  it("ne donne à chacun que ce que son poste propose", () => {
    /* Le vendeur ne reçoit pas le réglage qui change la méthode de la maison. */
    const missing = backfillGrants([], [seller], AT);
    expect(missing.map((g) => g.capability)).not.toContain('MANAGE_SETTINGS');
    expect(missing.every((g) => POST_PRESET.SELLER.includes(g.capability))).toBe(true);
  });

  it('rend un état stable : rejoué, il ne produit plus rien', () => {
    const first = backfillGrants([], [owner, seller], AT);
    expect(backfillGrants(first, [owner, seller], AT)).toEqual([]);
  });
});
