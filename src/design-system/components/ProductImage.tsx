import clsx from 'clsx';
import { IconPhoto } from '../icons';

/**
 * Vignette produit.
 * Sans photo, on affiche l'initiale sur fond sable plutôt qu'un pictogramme gris :
 * une grille de POS doit rester lisible même quand le catalogue n'est pas photographié.
 */
export function ProductImage({
  src, name, size = 'md', className,
}: {
  src?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims = { sm: 'h-10 w-10 text-[15px]', md: 'h-14 w-14 text-[19px]', lg: 'h-20 w-20 text-[26px]' }[size];

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={clsx('shrink-0 rounded-[6px] border border-ink-200 object-cover', dims, className)}
      />
    );
  }

  return (
    <div
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-[6px] border border-sable bg-sable-pale font-display text-brun',
        dims,
        className,
      )}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || <IconPhoto size={18} />}
    </div>
  );
}
