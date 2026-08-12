/**
 * Photos produit.
 *
 * Les visuels sont redimensionnés et recompressés AVANT stockage : une photo de
 * téléphone pèse plusieurs Mo et saturerait le stockage local, ce qui ferait
 * échouer l'enregistrement d'une vente. Un carré de 320 px suffit largement pour
 * une vignette de grille POS.
 *
 * En production, ces fichiers partiront vers Supabase Storage et l'article ne
 * conservera qu'un chemin ; l'interface d'appel ne changera pas.
 */

const MAX_EDGE = 320;
const QUALITY = 0.78;

export async function fileToThumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  // Recadrage carré centré : la grille POS est une grille de carrés.
  const edge = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - edge) / 2;
  const sy = (bitmap.height - edge) / 2;
  const target = Math.min(MAX_EDGE, edge);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Impossible de préparer l'image");
  ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, target, target);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', QUALITY);
}

export function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}
