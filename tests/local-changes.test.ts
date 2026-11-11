import "fake-indexeddb/auto";
import {beforeEach, expect, it, vi} from "vitest";
import {clearLocalVault, createVault, unlockVault} from "../src/core/vault";
import type {VaultData} from "../src/core/types";
import {createData} from "../src/seed";
import {LocalChanges} from "../src/local-changes";

beforeEach(clearLocalVault);
async function setup() {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const data = createData();
  const channelId = crypto.randomUUID();
  data.channels.push({id: channelId, name: "Notes", description: "", icon: "hash"});
  const session = await createVault(key, data);
  let visible = data;
  const error = vi.fn(), saved = vi.fn();
  const queue = new LocalChanges({session: () => session, data: value => {visible = value;}, state: vi.fn(), saved, error});
  const message = (text: string) => ({id: crypto.randomUUID(), channelId, text, createdAt: new Date().toISOString(), attachments: [], pinned: false});
  return {session, key, queue, error, saved, message, visible: () => visible};
}
it("shows a burst of sends, edits and deletes immediately and saves their exact order", async () => {
  const {session, key, queue, visible, message} = await setup();
  const messages = Array.from({length: 12}, (_, i) => message(`Note ${i}`));
  for (const m of messages) queue.add("Envoyer", d => d.messages.some(x => x.id === m.id) ? d : {...d, messages: [...d.messages, m]});
  queue.add("Modifier", d => ({...d, messages: d.messages.map(m => m.id === messages[2].id ? {...m, text: "Modifiée"} : m)}));
  queue.add("Supprimer", d => ({...d, messages: d.messages.filter(m => m.id !== messages[0].id)}));
  expect(visible().messages).toHaveLength(11);
  expect(visible().messages[1].text).toBe("Modifiée");
  expect(session.data.messages).toEqual([]);
  expect(queue.unsaved).toBe(true);
  await queue.flush();
  expect(queue.unsaved).toBe(false);
  expect(session.data.messages).toEqual(visible().messages);
  session.lock();
  expect((await unlockVault(key)).data.messages).toEqual(visible().messages);
});
it("keeps failed changes visible and retries in order without resurrecting a deleted send", async () => {
  const {session, queue, visible, message, error} = await setup();
  vi.spyOn(session, "update").mockRejectedValueOnce(new Error("Disque plein"));
  const m = message("À supprimer");
  queue.add("Envoyer", d => d.messages.some(x => x.id === m.id) ? d : {...d, messages: [...d.messages, m]});
  queue.add("Supprimer", d => ({...d, messages: d.messages.filter(x => x.id !== m.id)}));
  await expect(queue.flush()).rejects.toThrow("Disque plein");
  expect(error).toHaveBeenCalledWith("Disque plein");
  expect(visible().messages).toEqual([]);
  expect(session.data.messages).toEqual([]);
  queue.retryFailed();
  await queue.flush();
  expect(queue.unsaved).toBe(false);
  expect(session.data.messages).toEqual([]);
});
it("can cancel a failed edit and then durably save following actions", async () => {
  const {session, queue, message} = await setup();
  vi.spyOn(session, "update").mockRejectedValueOnce(new Error("Disque plein"));
  const add = (text: string) => { const m = message(text); return (d: VaultData) => d.messages.some(x => x.id === m.id) ? d : {...d, messages: [...d.messages, m]}; };
  queue.add("Premier", add("Annulé"));
  queue.add("Deuxième", add("Conservé"));
  await expect(queue.flush()).rejects.toThrow();
  queue.discardFailed();
  await queue.flush();
  expect(session.data.messages.map(m => m.text)).toEqual(["Conservé"]);
});
