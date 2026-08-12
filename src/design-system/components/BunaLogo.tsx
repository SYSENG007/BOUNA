import clsx from 'clsx';

/**
 * Le logo BUNA.
 *
 * Le fichier fourni est un emblème détaillé — caféier, rehauts crème et or —
 * posé sur un carré sombre. Deux usages, deux fichiers :
 *
 * · surface claire  → la tuile d'origine, arrondie. Les rehauts crème ont besoin
 *                     de leur fond sombre pour exister.
 * · surface café    → la version détourée, posée directement sur le brun.
 *
 * En dessous de 32 px l'illustration devient illisible : on lui préfère alors
 * la pastille de marque (`BunaMark`).
 */
export function BunaLogo({
  size = 44,
  surface = 'light',
  className,
}: {
  size?: number;
  surface?: 'light' | 'cafe';
  className?: string;
}) {
  const src = surface === 'cafe' ? '/brand/buna-logo-mark.svg' : '/brand/buna-logo.svg';
  return (
    <img
      src={src}
      alt="BUNA"
      width={size}
      height={size}
      className={clsx(
        'shrink-0 select-none',
        surface === 'light' && 'rounded-[8px] ring-1 ring-ink-200',
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Verrou de marque : l'emblème et le mot, dans les proportions du design system
 * (Playfair, interlettrage 0.3em).
 */
export function BunaLockup({
  subtitle,
  surface = 'light',
  size = 40,
}: {
  subtitle?: string;
  surface?: 'light' | 'cafe';
  size?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <BunaLogo size={size} surface={surface} />
      <div>
        {/* L'emblème porte le mot à grande taille ; en petit, le mot le relaie. */}
        {size < 48 && (
          <div
            className={clsx(
              'font-display text-[17px] leading-none tracking-[0.3em]',
              surface === 'cafe' ? 'text-sable-pale' : 'text-cafe',
            )}
          >
            BUNA
          </div>
        )}
        {subtitle && (
          <div
            className={clsx(
              'num mt-1 text-[10px] tracking-[0.14em]',
              surface === 'cafe' ? 'text-[#A08E7C]' : 'text-ink-400',
            )}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
