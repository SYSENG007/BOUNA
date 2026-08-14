import clsx from 'clsx';
import type { Actor } from '../../domain/actor';
import { actorFirstName, actorTime, isKnownActor } from '../../domain/actor';
import { CAPABILITY_LABEL, POST_LABEL } from '../../domain/capabilities';

/**
 * « Awa · vendeur · 14:32 »
 *
 * Le composant existe pour que la traçabilité ne soit pas une décision d'écran.
 * L'information était déjà en base ; elle n'était affichée nulle part. Une
 * primitive partagée est ce qui empêche la moitié des listes de l'oublier.
 */
export function ActorStamp({
  actor, showCapability = false, className,
}: {
  actor: Actor | undefined | null;
  /** Affiche sous quelle autorisation l'opération a été faite. */
  showCapability?: boolean;
  className?: string;
}) {
  if (!isKnownActor(actor)) {
    // On ne fabrique pas un auteur plausible : une trace inventée est pire
    // qu'une trace absente.
    return <span className={clsx('text-[11.5px] text-ink-400', className)}>Auteur inconnu</span>;
  }

  return (
    <span className={clsx('inline-flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-ink-500', className)}>
      <span className="font-medium text-ink-700">{actorFirstName(actor)}</span>
      <span aria-hidden="true">·</span>
      <span>{POST_LABEL[actor.post].toLowerCase()}</span>
      <span aria-hidden="true">·</span>
      <span className="num">{actorTime(actor)}</span>
      {showCapability && (
        <>
          <span aria-hidden="true">·</span>
          <span className="italic">{CAPABILITY_LABEL[actor.under].toLowerCase()}</span>
        </>
      )}
    </span>
  );
}
