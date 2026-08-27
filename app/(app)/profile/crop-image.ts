/**
 * Canvas export helper for `AvatarUploader`'s crop step (issue #49). Takes
 * the data-URL of the originally-selected image plus the pixel crop rect
 * `react-easy-crop`'s `onCropComplete` reports, and draws just that rect
 * into a fixed `outputSize`×`outputSize` canvas — this is what actually
 * "bakes in" the round-frame zoom/pan the user picked into a small, square
 * image before it ever reaches `uploadAvatar`. Standard approach for this
 * library (its own docs use the same canvas technique); kept local to this
 * module rather than added to `@yourorg/ui` since it's tied to the crop
 * step's specific `Area` shape, not a generic design-system primitive.
 */

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not load the selected image.")));
    image.src = src;
  });
}

export async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: PixelCrop,
  outputSize: number,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser does not support image cropping.");

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export the cropped image."));
      },
      "image/webp",
      0.92,
    );
  });
}
