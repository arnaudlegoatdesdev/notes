import { isDesktop } from "./desktop";

export function browserCloseGuard(hasPending: () => boolean): () => void {
  const handler = (event: BeforeUnloadEvent) => {
    if (!hasPending()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}
export class BackgroundExit {
  private running: Promise<void> | null = null;
  constructor(private options: {hide: () => Promise<void>; show: () => Promise<void>; flush: () => Promise<void>; exit: () => Promise<void>; error: (error: Error) => void}) {}
  request(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await this.options.hide();
        await Promise.race([
          this.options.flush(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("La synchronisation prend plus de temps que prévu. Vous pouvez continuer à utiliser Notes.")), 240_000); }),
        ]);
        await this.options.exit();
      } catch (error) {
        await this.options.show().catch(() => undefined);
        this.options.error(error instanceof Error ? error : new Error("La synchronisation n’est pas terminée."));
      } finally { clearTimeout(timer); this.running = null; }
    })();
    return this.running;
  }
}
export async function finishNativeExit(): Promise<void> {
  const {invoke} = await import("@tauri-apps/api/core");
  await invoke("finish_background_exit");
}
export async function pendingNativeWork(pending: boolean): Promise<void> {
  if (!isDesktop) return;
  const {invoke} = await import("@tauri-apps/api/core");
  await invoke("set_pending_work", {pending});
}
export async function nativeCloseGuard(options: {hasPending: () => boolean; flush: () => Promise<void>; error: (error: Error) => void}): Promise<{dispose: () => void; retry: () => Promise<void>}> {
  const [{getCurrentWindow}, {listen}] = await Promise.all([import("@tauri-apps/api/window"), import("@tauri-apps/api/event")]);
  const win = getCurrentWindow();
  const controller = new BackgroundExit({
    hide: () => win.hide(), show: async () => { await win.show(); await win.setFocus(); },
    flush: options.flush, exit: finishNativeExit, error: options.error,
  });
  const unclose = await win.onCloseRequested((event) => {
    if (!options.hasPending()) return;
    event.preventDefault();
    void controller.request();
  });
  let unquit: () => void;
  try { unquit = await listen("notes-quit-requested", () => { void controller.request(); }); }
  catch (error) { unclose(); throw error; }
  return {dispose: () => { unclose(); unquit(); }, retry: () => controller.request()};
}
