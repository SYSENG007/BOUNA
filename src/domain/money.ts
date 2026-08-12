/**
 * FCFA — pas de sous-unité. Espace insécable comme séparateur de milliers,
 * conformément à l'affichage des maquettes (« 487 500 FCFA »).
 */
export function fcfa(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  const digits = String(Math.round(Math.abs(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${sign}${digits}`;
}

export function fcfaFull(amount: number): string {
  return `${fcfa(amount)} FCFA`;
}

/** Écart signé, toujours affiché avec son signe (§ règles d'interface). */
export function signed(amount: number): string {
  if (amount === 0) return '0';
  return amount > 0 ? `+${fcfa(amount)}` : fcfa(amount);
}

export function percent(value: number, digits = 0): string {
  return `${value >= 0 ? '' : '−'}${Math.abs(value).toFixed(digits).replace('.', ',')} %`;
}
