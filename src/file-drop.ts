import {useEffect, useRef, useState, type RefObject} from "react";
import {isDesktop} from "./desktop";
export function isFileDrag(transfer: DataTransfer | null): boolean {
  return !!transfer && (Array.from(transfer.types || []).includes("Files") || !!transfer.files?.length);
}
export async function readNativeDroppedFile(path: string): Promise<File> {
  const {invoke} = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer | number[]>("read_dropped_file", {path});
  const name = path.split(/[\\/]/).pop() || "Fichier";
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const types: Record<string, string> = {png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",avif:"image/avif",svg:"image/svg+xml",txt:"text/plain",md:"text/markdown",markdown:"text/markdown",pdf:"application/pdf",mp4:"video/mp4",mp3:"audio/mpeg"};
  return new File([Array.isArray(bytes) ? new Uint8Array(bytes) : bytes], name, {type: types[extension] || "application/octet-stream"});
}
export function useChatFileDrop(options: {
  target: RefObject<HTMLElement | null>; enabled: boolean;
  files: (files: File[]) => void; paths: (paths: string[]) => void; error: (message: string) => void;
}) {
  const current = useRef(options); current.current = options;
  const [hover, setHover] = useState(false);
  useEffect(() => {if (!options.enabled) setHover(false);}, [options.enabled]);
  useEffect(() => {
    const inside = (node: Node | null) => current.current.enabled && !!node && !!current.current.target.current?.contains(node);
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      const accepted = inside(event.target as Node);
      if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? "copy" : "none";
      setHover(accepted);
    };
    const leave = (event: DragEvent) => {if (!inside(event.relatedTarget as Node)) setHover(false);};
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault(); setHover(false);
      if (!inside(event.target as Node)) return;
      if (Array.from(event.dataTransfer?.items || []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        current.current.error("Déposez des fichiers, pas des dossiers."); return;
      }
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) current.current.files(files);
    };
    const reset = () => setHover(false);
    document.addEventListener("dragenter", enter); document.addEventListener("dragover", enter);
    document.addEventListener("dragleave", leave); document.addEventListener("drop", drop);
    window.addEventListener("blur", reset);
    let disposed = false, unlisten: (() => void) | undefined;
    if (isDesktop) void import("@tauri-apps/api/webview").then(async ({getCurrentWebview}) => {
      const release = await getCurrentWebview().onDragDropEvent(({payload}) => {
        if (disposed) return;
        if (payload.type === "leave") {setHover(false); return;}
        // Wry's Cocoa drag handler supplies NSView points; Windows supplies pixels.
        const ratio = /Mac/.test(navigator.platform) ? 1 : window.devicePixelRatio || 1;
        const accepted = inside(document.elementFromPoint(payload.position.x / ratio, payload.position.y / ratio));
        setHover(payload.type !== "drop" && accepted);
        if (payload.type === "drop" && accepted) current.current.paths(payload.paths);
      });
      if (disposed) release(); else unlisten = release;
    }).catch(() => {if (!disposed) current.current.error("Le dépôt de fichiers n’est pas disponible dans cette version de Notes.");});
    return () => {
      disposed = true; unlisten?.();
      document.removeEventListener("dragenter", enter); document.removeEventListener("dragover", enter);
      document.removeEventListener("dragleave", leave); document.removeEventListener("drop", drop);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return hover && options.enabled;
}
