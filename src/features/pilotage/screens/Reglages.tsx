import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import {
  OPERATING_MODES, OPERATING_MODE_LABEL, OPERATING_MODE_SPECS, policyOf,
  type OperatingMode,
} from '../../../domain/operating-mode';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Card, SectionLabel, Segmented } from '../../../design-system/components/primitives';
import { IconCheck } from '../../../design-system/icons';

/**
 * Comment la maison suit ses coûts.
 *
 * Un interrupteur, et un seul panneau dessous : ce qu'on bascule décide de ce
 * qui s'affiche. Deux cartes côte à côte donnaient à lire un catalogue alors
 * que la question est binaire — on ne compare pas deux offres, on choisit une
 * manière de travailler.
 *
 * La bascule prend effet tout de suite, sans étape de confirmation. C'est
 * possible parce que le régime ne change RIEN de ce qui est enregistré : mêmes
 * faits, mêmes mouvements, mêmes projections. Revenir en arrière est le même
 * geste, dans l'autre sens, et ne recalcule rien. Une fenêtre de confirmation
 * ferait croire à une opération lourde ; elle ne l'est pas.
 *
 * Le fait, lui, est daté et signé : le journal dit qui a basculé et quand.
 */
export function Reglages() {
  const { operatingMode, setOperatingMode, can } = useBuna();
  const navigate = useNavigate();
  const [justChanged, setJustChanged] = useState<OperatingMode | null>(null);

  /* Ce que l'écran montre. Il suit le régime en cours, et le précède le temps
     que la bascule soit prise en compte. */
  const spec = OPERATING_MODE_SPECS[operatingMode];
  const policy = policyOf(operatingMode);
  const editable = can('MANAGE_SETTINGS');

  const flip = (mode: OperatingMode) => {
    if (mode === operatingMode) return;
    if (setOperatingMode(mode)) setJustChanged(mode);
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Suivi des coûts"
        subtitle="S'applique à toute l'équipe"
        onBack={() => navigate(-1)}
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-4">
        {/* L'interrupteur. C'est lui l'écran ; le reste explique ce qu'il fait. */}
        <Segmented
          full
          size="counter"
          value={operatingMode}
          onChange={flip}
          options={OPERATING_MODES.map((m) => ({ value: m, label: OPERATING_MODE_LABEL[m] }))}
        />

        <p className="px-1 text-[13.5px] leading-relaxed text-ink-700">{spec.summary}</p>

        {justChanged === operatingMode && (
          <Card className="border border-conforme bg-conforme-pale">
            <p className="text-[13px] leading-relaxed text-conforme-deep">
              C'est fait, et c'est enregistré au journal. Rien de ce qui a déjà été saisi n'a
              changé — seulement ce que l'application vous demande à partir de maintenant.
              Rebasculez quand vous voulez.
            </p>
          </Card>
        )}

        {!editable && (
          <Card className="border border-info bg-info-pale">
            <p className="text-[13px] leading-relaxed text-info-deep">
              Vous pouvez lire ce réglage, pas le changer. Il décide de la méthode de toute
              l'équipe : c'est au propriétaire de le porter.
            </p>
          </Card>
        )}

        {/* Ce que le régime choisi demande, déduit, et tait. Un seul panneau :
            il change avec l'interrupteur, il ne s'ajoute pas à côté. */}
        <Card className="space-y-4">
          <div>
            <SectionLabel className="mb-1.5">Ce que je déclare</SectionLabel>
            <ul className="space-y-1">
              {spec.declares.map((line) => (
                <li key={line} className="flex gap-2 text-[13.5px] leading-snug text-ink-700">
                  <IconCheck size={14} className="mt-[3px] shrink-0 text-brun" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Le filet doré marque ce que le système DÉDUIT, jamais ce qu'on déclare. */}
          <div className="derived">
            <SectionLabel className="mb-1.5">Ce que le système en déduit</SectionLabel>
            <ul className="space-y-1">
              {spec.derives.map((line) => (
                <li key={line} className="text-[13.5px] leading-snug text-ink-600">{line}</li>
              ))}
            </ul>
          </div>

          {/*
            Ce que le régime ne sait pas dire, écrit noir sur blanc. Un choix
            dont on cache la contrepartie n'est pas un choix — et un chiffre
            absent vaut mieux qu'un chiffre faux, encore faut-il savoir lequel
            manquera avant de basculer.
          */}
          {spec.silentOn.length > 0 && (
            <div>
              <SectionLabel className="mb-1.5">Ce qu'il ne saura pas dire</SectionLabel>
              <ul className="space-y-1">
                {spec.silentOn.map((line) => (
                  <li key={line} className="text-[13.5px] leading-snug text-ink-500">{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-[6px] bg-surveiller-pale px-3.5 py-2.5">
            <div className="text-[11.5px] font-medium uppercase tracking-wide text-or-ink">
              En échange
            </div>
            <p className="mt-0.5 text-[13px] leading-snug text-or-ink">{spec.requires}</p>
          </div>
        </Card>

        {/* Les conséquences concrètes, dans les mots des écrans concernés. */}
        <Card className="space-y-2">
          <SectionLabel>Ce que ça change, écran par écran</SectionLabel>
          <ul className="space-y-1.5 text-[13px] leading-snug text-ink-600">
            <li>
              <span className="text-ink-900">Préparation — </span>
              {policy.recipeRequiredToProduce
                ? 'une recette est exigée pour déclarer.'
                : 'un produit et une quantité suffisent ; la recette est facultative.'}
            </li>
            <li>
              <span className="text-ink-900">Comptoir — </span>
              {policy.saleBlockedWithoutStock
                ? "un produit préparé d'avance dont il ne reste rien est refusé."
                : 'la vente passe même quand le stock déclaré est épuisé.'}
            </li>
            <li>
              <span className="text-ink-900">Alertes — </span>
              {policy.finishedGoodsAlerts
                ? 'les produits finis en rupture réveillent la production.'
                : 'les produits finis ne déclenchent pas de rupture — leur stock est une déclaration.'}
            </li>
            <li>
              <span className="text-ink-900">Clôture — </span>
              {policy.countFinishedGoodsAtClosing
                ? 'compter les produits finis est obligatoire pour signer la journée.'
                : "le comptage des produits finis n'est pas exigé."}
            </li>
            <li>
              <span className="text-ink-900">Marge — </span>
              {policy.productMarginKnown
                ? 'calculée produit par produit, au coût des recettes.'
                : 'lue sur la période : stock initial + achats − stock final.'}
            </li>
          </ul>
        </Card>
      </main>
    </div>
  );
}
