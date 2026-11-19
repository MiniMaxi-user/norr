/**
 * Uploads queued work order photos (issue #224). Photos taken in the Photos
 * tab sit in the Dexie `localPhotos` queue (`lib/offline/db.ts`); this module
 * downscales each one, uploads it straight from the browser to the private
 * `work-order-photos` bucket under the engineer's own RLS-enforced session,
 * inserts the `work_order_photos` row, and only then deletes the local copy.
 *
 * Idempotent by construction: the photo's `clientPhotoKey` doubles as the row
 * id and the storage file name, the object is uploaded with `upsert: false`
 * (409 / "already exists" counts as success) and the row insert is
 * `on conflict (work_order_id, client_photo_key) do nothing` — so a crash or
 * dropped connection at any step is safely retried from scratch.
 *
 * Triggered from the Photos tab (after capture), Today (mount + `online`) and
 * Finish. Never throws; a failed photo simply stays queued.
 */
import { createClient } from "@/lib/supabase/client";
import type { WorkOrderDetailResponse } from "@/lib/work-orders/types";
import { deleteLocalPhoto, getAllLocalPhotos, getCachedWorkOrderDetail, type LocalPhoto } from "./db";

export const WORK_ORDER_PHOTO_BUCKET = "work-order-photos";

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.8;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

interface PreparedPhoto {
  blob: Blob;
  contentType: string;
  width: number | null;
  height: number | null;
}

/** Downscales to max 1600px on the long edge as JPEG (~0.8). Applies EXIF
 * orientation while decoding. If the browser can't decode the image (e.g.
 * HEIC), the original is returned untouched with its own type. */
async function preparePhoto(original: Blob): Promise<PreparedPhoto> {
  const originalType = ALLOWED_TYPES.includes(original.type) ? original.type : "image/jpeg";
  try {
    const bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2d context");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
      if (!blob || blob.size === 0) throw new Error("Encoding failed");
      return { blob, contentType: "image/jpeg", width, height };
    } finally {
      bitmap.close();
    }
  } catch {
    return { blob: original, contentType: originalType, width: null, height: null };
  }
}

/** Organization id for `workOrderId`: the cached detail if it has one, else
 * a fresh `/api/work-orders/[id]` read (also refreshes nothing — read only). */
async function resolveOrganizationId(workOrderId: string, userId: string): Promise<string | null> {
  const cached = await getCachedWorkOrderDetail(workOrderId, userId);
  if (cached?.detail.organizationId) return cached.detail.organizationId;
  const response = await fetch(`/api/work-orders/${workOrderId}`);
  if (!response.ok) return null;
  const data = (await response.json()) as WorkOrderDetailResponse;
  return data.organizationId ?? null;
}

async function uploadOne(photo: LocalPhoto, organizationId: string): Promise<boolean> {
  const supabase = createClient();
  const prepared = await preparePhoto(photo.blob);
  const extension = EXTENSIONS[prepared.contentType] ?? "jpg";
  const storagePath = `${organizationId}/${photo.workOrderId}/${photo.clientPhotoKey}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(WORK_ORDER_PHOTO_BUCKET)
    .upload(storagePath, prepared.blob, { contentType: prepared.contentType, upsert: false });
  if (uploadError) {
    const status = (uploadError as { statusCode?: string | number }).statusCode;
    const alreadyExists =
      String(status) === "409" || /already exists|duplicate/i.test(uploadError.message ?? "");
    if (!alreadyExists) return false;
  }

  const { error: insertError } = await supabase.from("work_order_photos").upsert(
    {
      id: photo.clientPhotoKey,
      work_order_id: photo.workOrderId,
      storage_path: storagePath,
      content_type: prepared.contentType,
      size_bytes: prepared.blob.size,
      width: prepared.width,
      height: prepared.height,
      taken_at: new Date(photo.takenAt).toISOString(),
      client_photo_key: photo.clientPhotoKey,
    },
    { onConflict: "work_order_id,client_photo_key", ignoreDuplicates: true },
  );
  return !insertError;
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;

async function runOnce(currentUserId: string): Promise<void> {
  const photos = await getAllLocalPhotos(currentUserId);
  const orgByWorkOrder = new Map<string, string | null>();
  for (const photo of photos) {
    try {
      if (!orgByWorkOrder.has(photo.workOrderId)) {
        orgByWorkOrder.set(photo.workOrderId, await resolveOrganizationId(photo.workOrderId, currentUserId));
      }
      const organizationId = orgByWorkOrder.get(photo.workOrderId);
      if (!organizationId) continue;
      const ok = await uploadOne(photo, organizationId);
      if (ok && photo.id !== undefined) await deleteLocalPhoto(photo.id);
    } catch {
      // Offline or a server error — the photo stays queued for the next run.
    }
  }
}

/** Uploads every queued photo for `currentUserId`. Best-effort, never
 * throws. Only one run at a time: a call made while one is in flight asks it
 * to do another pass (so a photo captured mid-run isn't missed) and returns
 * the same promise. */
export function retryPendingPhotoUploads(currentUserId: string): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        rerunRequested = false;
        await runOnce(currentUserId);
      } while (rerunRequested);
    } catch {
      // Swallowed on purpose — see doc comment.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
