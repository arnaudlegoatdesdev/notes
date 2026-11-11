// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {BackgroundExit, browserCloseGuard, nativeCloseGuard} from "../src/close-behavior";
const native = vi.hoisted(() => ({hide: vi.fn(async () => {}), show: vi.fn(async () => {}), setFocus: vi.fn(async () => {}), onCloseRequested: vi.fn(), listen: vi.fn(), invoke: vi.fn(async () => {})}));
vi.mock("@tauri-apps/api/window", () => ({getCurrentWindow: () => native}));
vi.mock("@tauri-apps/api/event", () => ({listen: native.listen}));
vi.mock("@tauri-apps/api/core", () => ({invoke: native.invoke}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve}; }
function setup(flush: () => Promise<void>) {
  const steps: string[] = [], error = vi.fn();
  const controller = new BackgroundExit({hide: async () => {steps.push("hide");}, show: async () => {steps.push("show");}, flush, exit: async () => {steps.push("exit");}, error});
  return {controller, steps, error};
}
it("hides once, finishes pending uploads, and only then exits", async () => {
  const gate = deferred(), {controller, steps, error} = setup(() => gate.promise);
  const first = controller.request();
  expect(controller.request()).toBe(first);
  await Promise.resolve();
  expect(steps).toEqual(["hide"]);
  gate.resolve();
  await first;
  expect(steps).toEqual(["hide", "exit"]);
  expect(error).not.toHaveBeenCalled();
});
it("restores the window on upload failure and allows a successful retry", async () => {
  const flush = vi.fn().mockRejectedValueOnce(new Error("Hors ligne")).mockResolvedValue(undefined);
  const {controller, steps, error} = setup(flush);
  await controller.request();
  expect(steps).toEqual(["hide", "show"]);
  expect(error.mock.calls[0][0].message).toBe("Hors ligne");
  await controller.request();
  expect(steps).toEqual(["hide", "show", "hide", "exit"]);
});
it("restores a hidden window rather than leaving a stuck upload indefinitely", async () => {
  vi.useFakeTimers();
  const {controller, steps, error} = setup(() => new Promise(() => {}));
  const closing = controller.request();
  await vi.advanceTimersByTimeAsync(240_000);
  await closing;
  expect(steps).toEqual(["hide", "show"]);
  expect(error).toHaveBeenCalledOnce();
});
it("warns before leaving a browser only while work remains and removes its listener", () => {
  let pending = false;
  const dispose = browserCloseGuard(() => pending);
  const attempt = () => { const event = new Event("beforeunload", {cancelable: true}); window.dispatchEvent(event); return event.defaultPrevented; };
  expect(attempt()).toBe(false);
  pending = true;
  expect(attempt()).toBe(true);
  pending = false;
  expect(attempt()).toBe(false);
  dispose();
  pending = true;
  expect(attempt()).toBe(false);
});
it("handles both the close button and native Quit while leaving clean closes immediate", async () => {
  const unclose = vi.fn(), unquit = vi.fn(), gate = deferred();
  native.onCloseRequested.mockResolvedValue(unclose);
  native.listen.mockResolvedValue(unquit);
  let pending = false;
  const guard = await nativeCloseGuard({hasPending: () => pending, flush: () => gate.promise, error: vi.fn()});
  const onClose = native.onCloseRequested.mock.calls[0][0];
  const preventDefault = vi.fn();
  onClose({preventDefault});
  expect(preventDefault).not.toHaveBeenCalled();
  pending = true;
  onClose({preventDefault});
  expect(preventDefault).toHaveBeenCalledOnce();
  native.listen.mock.calls[0][1]();
  await Promise.resolve();
  expect(native.hide).toHaveBeenCalledOnce();
  gate.resolve();
  await guard.retry();
  expect(native.invoke).toHaveBeenCalledWith("finish_background_exit");
  guard.dispose();
  expect(unclose).toHaveBeenCalledOnce();
  expect(unquit).toHaveBeenCalledOnce();
});
