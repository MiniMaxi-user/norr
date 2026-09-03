/**
 * Client-side compression for `ClientLogoUploader` (issue #120, "Logo wordt
 * gecomprimeerd opgeslagen"). Directly modeled on `app/(app)/profile/
 * crop-image.ts`'s canvas-export technique, minus the crop step: a company
 * logo isn't pre-cropped to a fixed shape the way a profile photo is (see
 * `@yourorg/ui`'s `CompanyLogo` doc comment) — "compressed" here just means
 * resize-to-max-dimension (aspect ratio preserved, never upscaled) + PNG
 * re-encode, which is "sufficient for use on an invoice" per the story. No
 * crop UI is needed for that bar.
 *
 * PNG, not webp (issue #119 fix): the invoice PDF (`app/(app)/quotes/
 * invoice-pdf.tsx`) embeds this same logo via `@react-pdf/renderer`, whose
 * underlying image resolver (`@react-pdf/image`) only recognizes
 * jpg/jpeg/png/svg — a webp logo silently fails to resolve (throws inside an
 * async image-loading path the renderer swallows), so the PDF was rendering
 * with a completely blank logo slot, no visible error anywhere. PNG also
 * preserves transparency, which webp did too but jpeg wouldn't have — the
 * right trade for a logo that's frequently a transparent-background asset.
 * Resizing to `maxDimension` (not format) is the actual size-reduction lever
 * here in either format, so this loses negligible compression benefit.
 */

const OUTPUT_MIME = "image/png";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not load the selected image.")));
    image.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the selected file."));
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Resizes `file` so neither dimension exceeds `maxDimension` (never
 * upscales a smaller source) and re-encodes it as webp. Returns the
 * compressed blob, ready to hand straight to `uploadClientLogo`'s
 * `FormData`.
 */
export async function compressLogoImage(file: File, maxDimension: number): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser does not support image compression.");

  ctx.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    // No quality argument: PNG is lossless, canvas.toBlob's third argument
    // only has an effect for lossy formats (jpeg/webp) and is ignored here.
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not process the logo."));
    }, OUTPUT_MIME);
  });
}
