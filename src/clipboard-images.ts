/** Read only image files supplied by the user's paste gesture. */
export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const images = Array.from(data.items || []).flatMap(item => {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) return [];
    const file = item.getAsFile();
    return file ? [{file, type: item.type}] : [];
  });
  // Some WebViews expose clipboard files without DataTransferItem entries.
  const found = images.length ? images : Array.from(data.files || [])
    .filter(file => file.type.toLowerCase().startsWith("image/"))
    .map(file => ({file, type: file.type}));
  return found.map(({file, type}, index) => {
    if (file.name && file.type) return file;
    const extension = type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
    return new File([file], file.name || `image-${index + 1}.${extension}`, {type: file.type || type, lastModified: file.lastModified});
  });
}
