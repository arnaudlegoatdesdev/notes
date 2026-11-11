import type { VaultData } from "./core/types";
import type { VaultSession } from "./core/vault";
import { stampChanges } from "./merge";

export interface LocalChange {
  id: string; label: string; state: "queued" | "saving" | "failed"; error?: string;
  apply: (data: VaultData) => VaultData; at: string;
  session: VaultSession; after?: (session: VaultSession) => Promise<void>;
}
/** Optimistic UI over a serial, durable local queue. No network work belongs here. */
export class LocalChanges {
  private entries: LocalChange[] = [];
  private tail: Promise<void> = Promise.resolve();
  constructor(private options: {
    session: () => VaultSession | null;
    data: (data: VaultData) => void;
    state: (pending: number, failed: LocalChange[]) => void;
    saved: () => void;
    error: (message: string) => void;
  }) {}
  get pending() {
    // Entries behind a failed write are paused until retry or cancellation.
    const failed = this.entries.findIndex((e) => e.state === "failed");
    return (failed < 0 ? this.entries : this.entries.slice(0, failed)).length;
  }
  get unsaved() { return this.entries.length > 0; }
  refresh() {
    const session = this.options.session();
    if (session) this.options.data(this.entries.reduce((data, e) => e.apply(data), session.data));
    this.options.state(this.pending, this.entries.filter((e) => e.state === "failed"));
  }
  add(label: string, apply: LocalChange["apply"], after?: LocalChange["after"]) {
    const session = this.options.session();
    if (!session) return;
    const entry: LocalChange = {id: crypto.randomUUID(), label, state: "queued", at: new Date().toISOString(), apply, session, after};
    this.entries.push(entry);
    this.refresh();
    this.schedule(entry);
  }
  private schedule(entry: LocalChange) {
    this.tail = this.tail.then(async () => {
      // Preserve user action order even after a disk/quota error. In particular,
      // retrying an earlier send must never resurrect a later deleted message.
      if (this.entries[0] !== entry || entry.state !== "queued") return;
      try {
        if (this.options.session() !== entry.session) throw new Error("Le compte Notes a changé.");
        entry.state = "saving";
        await entry.session.update((current) => stampChanges(current, entry.apply(current), entry.at));
        this.options.saved();
        await entry.after?.(entry.session);
        this.entries = this.entries.filter((e) => e !== entry);
      } catch (error) {
        entry.state = "failed";
        entry.error = error instanceof Error ? error.message : "L’enregistrement local a échoué.";
        this.options.error(entry.error);
      }
      this.refresh();
    });
  }
  retryFailed() {
    for (const entry of this.entries) if (entry.state === "failed") entry.state = "queued";
    for (const entry of this.entries) if (entry.state === "queued") this.schedule(entry);
    this.refresh();
  }
  discardFailed() {
    this.entries = this.entries.filter((e) => e.state !== "failed");
    for (const entry of this.entries) if (entry.state === "queued") this.schedule(entry);
    this.refresh();
  }
  async flush() {
    // New actions may have been added while an earlier local write was settling.
    while (true) { const current = this.tail; await current; if (this.tail === current) break; }
    const failed = this.entries.find((e) => e.state === "failed");
    if (failed) throw new Error(failed.error || "Une modification n’a pas été enregistrée.");
  }
  clear() { if (this.entries.length) throw new Error("Attendez l’enregistrement des modifications."); }
}
