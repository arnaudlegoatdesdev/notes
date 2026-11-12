export interface View {scale: number; x: number; y: number;}
export interface Size {width: number; height: number;}
export const MIN_ZOOM = 1, MAX_ZOOM = 8;
export function fitImage(image: Size, viewport: Size): Size {
  const fit = Math.max(.001, Math.min(1, (viewport.width - 28) / Math.max(1, image.width), (viewport.height - 28) / Math.max(1, image.height)));
  return {width: image.width * fit, height: image.height * fit};
}
export function constrainView(view: View, image: Size, viewport: Size): View {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.scale));
  const x = Math.max(0, (image.width * scale - viewport.width) / 2);
  const y = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {scale, x: Math.max(-x, Math.min(x, view.x)), y: Math.max(-y, Math.min(y, view.y))};
}
/** Keep the image point under the cursor or pinch midpoint fixed on screen. */
export function zoomAt(view: View, scale: number, point: {x: number; y: number}): View {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  const ratio = next / view.scale;
  return {scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio};
}
