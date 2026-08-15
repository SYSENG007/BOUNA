import { useMemo, useRef, useState } from 'react';
import { useBuna } from '../../../store/BunaStore';
import { uuid } from '../../../domain/ids';
import { fileToThumbnail, isImage } from '../../../domain/image';
import { fcfaFull } from '../../../domain/money';
import { canConvert } from '../../../domain/units';
import { UNIT_LABEL, type Item, type ItemKind, type Unit } from '../../../domain/types';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { ProductImage } from '../../../design-system/components/ProductImage';
import {
  Button, Card, Field, SectionLabel, SelectField,
} from '../../../design-system/components/primitives';
import { IconPhoto } from '../../../design-system/icons';
import { SUPPLIERS } from '../../../store/BunaStore';

const KIND_OPTIONS: { value: ItemKind; label: string }[] = [
  { value: 'FINISHED', label: 'Produit fini — vendu au comptoir' },
  { value: 'RAW_MATERIAL', label: 'Matière première' },
  { value: 'PACKAGING', label: 'Emballage' },
  { value: 'INTERMEDIATE', label: 'Préparation intermédiaire' },
];

const UNITS: Unit[] = ['unite', 'L', 'mL', 'kg', 'g', 'bouteille', 'sachet', 'paquet', 'carton'];

/** Création et modification d'un article. Une seule action pleine : « Enregistrer ». */
export function ItemEditor({ item, onDone }: { item: Item | null; onDone: () => void }) {
  const { state, saveItem, archiveItem } = useBuna();
  const fileInput = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Item>(
    item ?? {
      id: uuid(), name: '', kind: 'FINISHED', unit: 'unite',
      price: undefined, weightedAvgCost: 0, minimumStock: undefined, targetStock: undefined,
    },
  );
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const patch = (next: Partial<Item>) => setDraft((d) => ({ ...d, ...next }));
  const isFinished = draft.kind === 'FINISHED' || draft.kind === 'INTERMEDIATE';
  const nameMissing = draft.name.trim().length === 0;

  /*
   * Changer l'unité d'un article déjà mouvementé rendait son stock illisible.
   *
   * Les mouvements gardent l'unité dans laquelle ils ont été écrits — c'est le
   * fait, il ne se réécrit pas. Passer le cacao de kilos à unités laissait donc
   * des réceptions en kg face à un article en unités, deux familles qu'aucun
   * facteur ne relie : la projection les écarte, et le stock affiché devient
   * faux sans que personne l'ait demandé.
   *
   * On ne propose donc plus que les unités de la même famille dès qu'un
   * mouvement existe. Le prix, le coût et les seuils restent modifiables : ce
   * sont eux qu'on vient changer.
   */
  const movedUnits = useMemo(() => {
    if (!item) return [];
    const seen = new Set<Unit>();
    for (const m of state.movements) if (m.itemId === item.id) seen.add(m.unit);
    return [...seen];
  }, [item, state.movements]);

  const unitLocked = movedUnits.length > 0;
  /*
   * L'unité portée aujourd'hui reste toujours proposée, même si elle est déjà
   * incompatible avec les mouvements : un article abîmé par l'ancienne version
   * doit s'afficher tel qu'il est — sinon la liste montrerait une unité que
   * l'article n'a pas — et rester réparable vers la bonne famille.
   */
  const unitOptions = unitLocked
    ? UNITS.filter((u) => u === draft.unit || movedUnits.every((moved) => canConvert(moved, u)))
    : UNITS;

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!isImage(file)) {
      setImageError('Ce fichier n’est pas une image. Choisissez un JPEG ou un PNG.');
      return;
    }
    setImageError(null);
    setImageBusy(true);
    try {
      patch({ imageUrl: await fileToThumbnail(file) });
    } catch {
      setImageError("L'image n'a pas pu être préparée. Réessayez avec une autre photo.");
    } finally {
      setImageBusy(false);
    }
  };

  const submit = () => {
    if (nameMissing) return;
    saveItem({ ...draft, name: draft.name.trim() });
    onDone();
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title={item ? 'Modifier l’article' : 'Nouvel article'}
        subtitle={item ? item.name : 'Catalogue'}
        onBack={onDone}
      />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        {/* Photo — la grille de vente se lit à l'image avant de se lire au mot. */}
        <Card className="flex items-center gap-4">
          <ProductImage src={draft.imageUrl} name={draft.name || '?'} size="lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <SectionLabel>Photo du produit</SectionLabel>
            <p className="text-[12px] leading-snug text-ink-500">
              Carré, recadrée automatiquement. Elle apparaît sur la grille de vente.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="compact" disabled={imageBusy} onClick={() => fileInput.current?.click()}>
                <IconPhoto size={15} />
                {imageBusy ? 'Préparation…' : draft.imageUrl ? 'Remplacer' : 'Ajouter une photo'}
              </Button>
              {draft.imageUrl && (
                <Button size="compact" variant="ghost" onClick={() => patch({ imageUrl: undefined })}>
                  Retirer
                </Button>
              )}
            </div>
            {imageError && <p className="text-[12px] text-critique">{imageError}</p>}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pickImage(e.target.files?.[0])}
          />
        </Card>

        <Field
          label="Nom"
          placeholder="ex. Vanilla Iced Coffee"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          error={nameMissing ? undefined : undefined}
        />

        <SelectField
          label="Type"
          value={draft.kind}
          onChange={(v) => patch({ kind: v as ItemKind })}
          options={KIND_OPTIONS}
        />

        <SelectField
          label="Unité"
          value={draft.unit}
          onChange={(v) => patch({ unit: v as Unit })}
          options={unitOptions.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
          hint={
            unitLocked
              ? `Cet article a déjà des mouvements de stock comptés en ${movedUnits.map((u) => UNIT_LABEL[u]).join(', ')}. Vous pouvez encore affiner l'unité dans la même famille — pour en changer vraiment, créez un nouvel article.`
              : "L'unité dans laquelle vous comptez cet article au quotidien."
          }
        />

        {isFinished && (
          <Field
            label="Prix de vente"
            type="number"
            inputMode="numeric"
            suffix="FCFA"
            value={draft.price ?? ''}
            onChange={(e) => patch({ price: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        )}

        <Field
          label="Coût unitaire"
          type="number"
          inputMode="numeric"
          suffix="FCFA"
          value={draft.weightedAvgCost ?? 0}
          onChange={(e) => patch({ weightedAvgCost: Number(e.target.value) })}
          hint="Valeur de départ. Chaque réception la recalcule en moyenne pondérée."
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Stock minimum"
            type="number"
            inputMode="decimal"
            suffix={UNIT_LABEL[draft.unit]}
            value={draft.minimumStock ?? ''}
            onChange={(e) => patch({ minimumStock: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <Field
            label="Stock cible"
            type="number"
            inputMode="decimal"
            suffix={UNIT_LABEL[draft.unit]}
            value={draft.targetStock ?? ''}
            onChange={(e) => patch({ targetStock: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </div>

        {draft.kind !== 'FINISHED' && (
          <SelectField
            label="Fournisseur habituel"
            value={draft.preferredSupplierId ?? ''}
            onChange={(v) => patch({ preferredSupplierId: v || undefined })}
            options={[{ value: '', label: 'Aucun' }, ...SUPPLIERS.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}

        {/* Ce que ces seuils vont déclencher — le filet doré marque la déduction. */}
        {draft.minimumStock != null && draft.targetStock != null && (
          <div className="derived">
            <SectionLabel className="mb-1">Déduit de ces seuils</SectionLabel>
            <p className="t-small text-ink-600">
              Sous {draft.minimumStock} {UNIT_LABEL[draft.unit]}, l'article passe en critique et remonte dans la liste
              de courses avec une quantité recommandée pour atteindre {draft.targetStock} {UNIT_LABEL[draft.unit]}.
            </p>
          </div>
        )}

        {isFinished && draft.price != null && draft.price > 0 && (
          <div className="derived">
            <SectionLabel className="mb-1">Marge unitaire</SectionLabel>
            <p className="t-small text-ink-600">
              {fcfaFull(draft.price - (draft.weightedAvgCost ?? 0))} par unité, soit{' '}
              {Math.round(((draft.price - (draft.weightedAvgCost ?? 0)) / draft.price) * 100)} % du prix.
            </p>
          </div>
        )}

        {item && (
          <Button
            variant="danger"
            full
            onClick={() => {
              if (confirm(`Archiver « ${item.name} » ? Il disparaît du catalogue, son historique reste.`)) {
                archiveItem(item.id);
                onDone();
              }
            }}
          >
            Archiver l'article
          </Button>
        )}
      </main>

      <div className="action-bar rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 backdrop-blur">
        <div className="flex gap-2.5">
          <Button size="counter" className="flex-1" onClick={onDone}>Annuler</Button>
          <Button variant="primary" size="counter" className="flex-[1.6]" disabled={nameMissing} onClick={submit}>
            {nameMissing ? 'Nommez l’article' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>
  );
}
