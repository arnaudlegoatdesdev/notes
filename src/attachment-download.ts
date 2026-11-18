import { isDesktop } from "./desktop";

export async function saveAttachment(blob: Blob, name: string): Promise<"saved" | "started" | "cancelled"> {
  if (isDesktop) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const written = await invoke<boolean>("save_attachment", await blob.arrayBuffer(), {
        headers: { "X-Notes-Filename": encodeURIComponent(name) },
      });
      return written ? "saved" : "cancelled";
    } catch (error) {
      throw new Error(typeof error === "string" ? error : "Impossible d’enregistrer le fichier.");
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // A browser download does not expose disk-write completion to the page.
  return "started";
}
