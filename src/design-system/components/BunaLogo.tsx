import clsx from 'clsx';

/**
 * Le logo BUNA — l'emblème détouré, posé directement sur le fond.
 *
 * Pas de tuile, pas de cadre : le caféier vit sur la surface de l'écran.
 * En dessous de 32 px l'illustration devient illisible ; on lui préfère alors
 * la pastille de marque (`BunaMark`).
 */
export function BunaLogo({
  size = 44,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/buna-logo-mark.svg"
      alt="BUNA"
      width={size}
      height={size}
      className={clsx('shrink-0 select-none', className)}
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
      <BunaLogo size={size} />
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
