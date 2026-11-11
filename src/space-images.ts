import { isSpaceImage } from "./core/space-image";

export async function prepareSpaceImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type))
    throw new Error("Choisissez une image PNG, JPG, WebP, GIF ou AVIF.");
  if (!file.size || file.size > 10 * 1024 ** 2)
    throw new Error("10 Mio maximum par image.");
  const url = URL.createObjectURL(file);
  const image = new window.Image();
  try {
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error("Impossible de lire cette image."); }
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error("Image invalide.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossible de préparer cette image.");
    const side = Math.min(width, height);
    for (const size of [256, 192, 128]) {
      canvas.width = canvas.height = size;
      context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
      const result = canvas.toDataURL("image/webp", 0.8);
      if (isSpaceImage(result)) return result;
    }
    throw new Error("Cette image est trop détaillée. Choisissez-en une autre.");
  } finally {
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
