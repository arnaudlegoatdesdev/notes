import {expect, it} from "vitest";
import {clipboardImages} from "../src/clipboard-images";
function data(items: unknown[], files: File[] = []) {return {items, files} as unknown as DataTransfer;}
it("reads an image once even when both clipboard representations contain it", () => {
  const image = new File(["image"], "capture.png", {type:"image/png"});
  const clipboard = data([{kind:"string",type:"text/html"},{kind:"file",type:image.type,getAsFile:()=>image}], [image]);
  expect(clipboardImages(clipboard)).toEqual([image]);
});
it("supports WebViews exposing only clipboard files and names unnamed images", () => {
  const image = new File(["image"], "", {type:"image/png"});
  const result = clipboardImages(data([], [image]));
  expect(result).toHaveLength(1); expect(result[0].name).toBe("image-1.png"); expect(result[0].type).toBe("image/png");
});
it("keeps normal text and non-image pastes untouched and ignores empty clipboard items", () => {
  expect(clipboardImages(null)).toEqual([]);
  expect(clipboardImages(data([{kind:"string",type:"text/plain"}], [new File(["text"],"note.txt",{type:"text/plain"})]))).toEqual([]);
  expect(clipboardImages(data([{kind:"file",type:"image/png",getAsFile:()=>null}]))).toEqual([]);
});
it("retains the clipboard image type when its file representation omits it", () => {
  const result=clipboardImages(data([{kind:"file",type:"image/png",getAsFile:()=>new File(["image"],"image.png")}]))[0];
  expect(result.type).toBe("image/png"); expect(result.size).toBe(5);
});
