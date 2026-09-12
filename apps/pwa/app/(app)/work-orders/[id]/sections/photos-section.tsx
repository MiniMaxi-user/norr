"use client";

import { useEffect, useRef, useState } from "react";
import { Inline, MediaTile, Stack, Text } from "@yourorg/ui";
import { Camera } from "@yourorg/ui/icons";
import { addLocalPhoto, type LocalPhoto } from "@/lib/offline/db";

/**
 * The "Photos" tab (issue #170, IMPLEMENTATION.md §4) — a big dashed "Take
 * photo" button (a hidden `<input type="file" accept="image/*"
 * capture="environment">` under the hood, the standard mobile-web way to
 * open the device camera directly rather than a full picker) and a grid of
 * whatever's been taken. Local-only, like every other #170 outbox table
 * (`lib/offline/db.ts`) — nothing here is ever posted to the server in this
 * story.
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

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await addLocalPhoto({ workOrderId, userId: currentUserId, takenAt: Date.now(), blob: file });
    await onPhotosChange();
  }

  return (
    <Stack gap="md">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handleFileChange(event)}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          minHeight: 96,
          borderRadius: "var(--ui-radius-lg)",
          border: "2px dashed var(--ui-border-strong)",
          background: "transparent",
          color: "var(--ui-muted)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          cursor: "pointer",
        }}
      >
        <Camera aria-hidden width={22} height={22} />
        <Text>Take photo</Text>
      </button>

      {photos.length === 0 ? (
        <Text tone="muted">No photos attached yet.</Text>
      ) : (
        <Inline gap="sm" wrap>
          {photos.map((photo) => (
            <MediaTile
              key={photo.id}
              imageUrl={photo.id !== undefined ? objectUrls[photo.id] : undefined}
              alt="Work order photo"
              size="md"
              fallback={<Camera aria-hidden />}
            />
          ))}
        </Inline>
      )}
    </Stack>
  );
}
