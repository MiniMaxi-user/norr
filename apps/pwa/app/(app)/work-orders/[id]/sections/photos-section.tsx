"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MediaTile } from "@yourorg/ui";
import { PwaCardPad, PwaStack, WebCard } from "@yourorg/ui/web";
import { Camera } from "@yourorg/ui/icons";
import { addLocalPhoto, type LocalPhoto } from "@/lib/offline/db";
import { retryPendingPhotoUploads, WORK_ORDER_PHOTO_BUCKET } from "@/lib/offline/photo-sync";
import { createClient } from "@/lib/supabase/client";

interface ServerPhoto {
  id: string;
  clientPhotoKey: string | null;
  url: string;
}

/**
 * The "Photos" tab (issue #170, IMPLEMENTATION.md §4) — a big dashed "Take
 * photo" button (a hidden `<input type="file" accept="image/*"
 * capture="environment">` under the hood, the standard mobile-web way to
 * open the device camera directly rather than a full picker) and a grid of
 * whatever's been taken. New photos queue locally and are uploaded to the
 * work-order-photos bucket in the background (issue #224, `photo-sync.ts`);
 * until then they show a "Pending" badge. Already-uploaded photos are listed
 * from the server via signed URLs.
 */
export function PhotosSection({
  workOrderId,
  currentUserId,
  photos,
  onPhotosChange,
}: {
  workOrderId: string;
  currentUserId: string;
  photos: LocalPhoto[];
  onPhotosChange: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [objectUrls, setObjectUrls] = useState<Record<number, string>>({});
  const [serverPhotos, setServerPhotos] = useState<ServerPhoto[]>([]);

  const loadServerPhotos = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("work_order_photos")
        .select("id, storage_path, client_photo_key")
        .eq("work_order_id", workOrderId)
        .order("taken_at", { ascending: true });
      if (error || !data) return;
      const signed = data.length
        ? await supabase.storage
            .from(WORK_ORDER_PHOTO_BUCKET)
            .createSignedUrls(data.map((row) => row.storage_path), 3600)
        : { data: [], error: null };
      if (signed.error || !signed.data) return;
      const urlByPath = new Map(signed.data.map((entry) => [entry.path, entry.signedUrl]));
      setServerPhotos(
        data.flatMap((row) => {
          const url = urlByPath.get(row.storage_path);
          return url ? [{ id: row.id, clientPhotoKey: row.client_photo_key, url }] : [];
        }),
      );
    } catch {
      // Offline — the server list just stays as it was.
    }
  }, [workOrderId]);

  const uploadAndRefresh = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    await retryPendingPhotoUploads(currentUserId);
    await onPhotosChange();
    await loadServerPhotos();
  }, [currentUserId, onPhotosChange, loadServerPhotos]);

  // On open and whenever connectivity returns: flush the queue, then show
  // what the server has.
  useEffect(() => {
    void uploadAndRefresh();
    window.addEventListener("online", uploadAndRefresh);
    return () => window.removeEventListener("online", uploadAndRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on mount/online only; onPhotosChange identity is not a trigger.
  }, [workOrderId, currentUserId]);

  // Object URLs are created/revoked here, not per-render — a fresh
  // `URL.createObjectURL` call on every render would leak one URL per
  // render for as long as the tab stays open.
  useEffect(() => {
    const next: Record<number, string> = {};
    for (const photo of photos) {
      if (photo.id !== undefined) next[photo.id] = URL.createObjectURL(photo.blob);
    }
    setObjectUrls(next);
    return () => {
      Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the photo list identity via its length/ids below, not the array reference, to avoid re-creating URLs on every unrelated parent re-render.
  }, [photos.map((photo) => photo.id).join(",")]);

  const pendingKeys = new Set(photos.map((photo) => photo.clientPhotoKey));
  const visibleServerPhotos = serverPhotos.filter((photo) => !photo.clientPhotoKey || !pendingKeys.has(photo.clientPhotoKey));

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await addLocalPhoto({ workOrderId, userId: currentUserId, takenAt: Date.now(), blob: file });
    await onPhotosChange();
    void uploadAndRefresh();
  }

  return (
    <PwaStack>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handleFileChange(event)}
        className="pwa-hidden"
      />
      <button type="button" className="pwa-dropzone" onClick={() => inputRef.current?.click()}>
        <Camera aria-hidden width={22} height={22} />
        Take photo
      </button>

      <WebCard size="touch" title="Photos" meta={String(photos.length + visibleServerPhotos.length)}>
        {photos.length + visibleServerPhotos.length === 0 ? (
          <p className="pwa-list-empty">No photos attached yet.</p>
        ) : (
          <PwaCardPad>
            <div className="pwa-photo-grid">
              {visibleServerPhotos.map((photo) => (
                <MediaTile key={photo.id} imageUrl={photo.url} alt="Work order photo" size="md" fallback={<Camera aria-hidden />} />
              ))}
              {photos.map((photo) => (
                <MediaTile
                  key={photo.id}
                  imageUrl={photo.id !== undefined ? objectUrls[photo.id] : undefined}
                  alt="Work order photo"
                  size="md"
                  badge="Pending"
                  fallback={<Camera aria-hidden />}
                />
              ))}
            </div>
          </PwaCardPad>
        )}
      </WebCard>
    </PwaStack>
  );
}
