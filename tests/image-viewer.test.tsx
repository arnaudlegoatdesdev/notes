// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {act} from "react";
import ImageViewer from "../src/components/ImageViewer";
import {zoomAt, constrainView} from "../src/image-view";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({x:100,y:80,left:100,top:80,right:900,bottom:680,width:800,height:600,toJSON(){}});
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => true;
  class Pointer extends MouseEvent {pointerId: number; constructor(type: string, init: PointerEventInit) {super(type, init); this.pointerId = init.pointerId || 0;}}
  vi.stubGlobal("PointerEvent", Pointer);
});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
function viewer() {
  const onClose = vi.fn();
  const {container, unmount} = render(<ImageViewer url="blob:test" name="photo.png" onClose={onClose}/>);
  const image = screen.getByAltText("photo.png");
  Object.defineProperties(image, {naturalWidth:{value:2000},naturalHeight:{value:1200}});
  fireEvent.load(image);
  return {image, stage: container.querySelector(".viewer-stage")!, onClose, unmount};
}
it("smoothly zooms around the cursor without resizing the image layout", async () => {
  const {image, stage} = viewer();
  const width = image.style.width;
  fireEvent.wheel(stage, {deltaY:-200, clientX:700, clientY:430});
  expect(screen.getByText("100 %")).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(32));
  const intermediate = image.style.transform;
  await act(async () => vi.advanceTimersByTime(500));
  expect(image.style.transform).not.toBe(intermediate);
  const match = image.style.transform.match(/translate3d\(([-.\d]+)px, ([-.\d]+)px, 0\) scale\(([-.\d]+)\)/)!;
  const [, x, y, scale] = match.map(Number);
  expect(scale).toBeGreaterThan(1.8);
  expect((200 - x) / scale).toBeCloseTo(200, 1);
  expect((50 - y) / scale).toBeCloseTo(50, 1);
  expect(image.style.width).toBe(width);
});
it("pans a zoomed image, resets it and keeps Escape and focus restoration working", async () => {
  const before = document.createElement("button"); document.body.append(before); before.focus();
  const {image, stage, onClose, unmount} = viewer();
  fireEvent.click(screen.getByRole("button", {name:"Zoomer"}));
  await act(async () => vi.advanceTimersByTime(500));
  const transform = image.style.transform;
  fireEvent.pointerDown(image, {pointerId:1,button:0,clientX:500,clientY:380});
  fireEvent.pointerMove(stage, {pointerId:1,clientX:540,clientY:380});
  fireEvent.pointerUp(stage, {pointerId:1,clientX:540,clientY:380});
  fireEvent.click(stage);
  expect(image.style.transform).not.toBe(transform);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Ajuster l’image"}));
  await act(async () => vi.advanceTimersByTime(500));
  expect(screen.getByText("100 %")).toBeTruthy();
  fireEvent.keyDown(document, {key:"Escape"}); expect(onClose).toHaveBeenCalledOnce();
  unmount(); expect(document.activeElement).toBe(before); before.remove();
});
it("pinches around two moving fingers without interpreting the release as a click", () => {
  const {image, stage, onClose} = viewer();
  fireEvent.pointerDown(image,{pointerId:1,button:0,clientX:400,clientY:380});
  fireEvent.pointerDown(image,{pointerId:2,button:0,clientX:600,clientY:380});
  fireEvent.pointerMove(stage,{pointerId:2,clientX:700,clientY:380});
  expect(screen.getByText("150 %")).toBeTruthy();
  fireEvent.pointerUp(stage,{pointerId:2}); fireEvent.pointerUp(stage,{pointerId:1});
  fireEvent.click(stage); expect(onClose).not.toHaveBeenCalled(); expect(screen.getByText("150 %")).toBeTruthy();
});
it("preserves an off-centre image point through repeated zooms and constrains extreme panning", () => {
  const first = {scale:2,x:-80,y:40}, point = {x:150,y:-70};
  const enlarged = zoomAt(first,4,point), returned = zoomAt(enlarged,2,point);
  expect(returned).toEqual(first);
  expect(constrainView({scale:2,x:9999,y:-9999},{width:800,height:600},{width:800,height:600})).toEqual({scale:2,x:400,y:-300});
});
