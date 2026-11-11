// A small embedded thumbnail stays inside the encrypted manifest and its quota.
export const MAX_SPACE_IMAGE_LENGTH = 65_536;
export function isSpaceImage(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SPACE_IMAGE_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
