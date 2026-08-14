import type { Actor } from '../actor';
import { POST_PRESET } from '../capabilities';

/**
 * Acteur par défaut des fabriques de test. Ce qui compte pour la plupart des
 * assertions, c'est que le fait *ait* un auteur — les tests qui vérifient la
 * traçabilité elle-même construisent leur propre tampon.
 */
export const TEST_ACTOR: Actor = {
  userId: 'u-aicha',
  userName: 'Aicha Ndiaye',
  post: 'SELLER',
  under: 'SELL',
  deviceId: 'device-test',
  at: '2026-08-12T10:00:00.000Z',
};

export const TEST_MANAGER = {
  id: 'u-mariama',
  post: 'MANAGER' as const,
  capabilities: POST_PRESET.MANAGER,
};
