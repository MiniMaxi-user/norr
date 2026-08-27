"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Avatar, Button, Inline, Slider, Stack, Text } from "@yourorg/ui";
import { Camera, Trash2 } from "@yourorg/ui/icons";
import { getCroppedImageBlob } from "./crop-image";
import { removeAvatar, uploadAvatar } from "./actions";

const CROP_ASPECT = 1;
// 512px keeps the exported webp small (the crop always starts from the
// user's already-cropped, largely-headshot-sized selection) while still
// looking sharp at any size this app currently renders an avatar
// (`Avatar`'s largest variant, `lg`, is 56px — 512px source is comfortably
// ahead of any realistic future @2x/@3x use).
const OUTPUT_SIZE = 512;

/**
 * Avatar section of `ProfilePanel` (issue #49): shows the current photo (or
 * initials fallback), and drives the whole select → crop/zoom (round frame)
 * → upload flow, plus "Remove". Owns all of that flow's local state itself
 * so `ProfilePanel` doesn't need to know about crop mechanics — it only
 * gets notified of the end result via `onAvatarChange`, the same "tell the
 * parent what changed, not how" shape `ProfilePanel` itself uses for the
 * rest of the form.
 *
 * `react-easy-crop`'s `cropShape="round"` gives the "rond kader" (round
 * frame) requirement natively — no custom mask needed — and `zoom` is
 * driven by `@yourorg/ui`'s new `Slider` primitive (added in this change,
 * this app's first slider need).
 */
export function AvatarUploader({
  name,
  avatarUrl,
  onAvatarChange,
}: {
  name: string;
  avatarUrl: string | null;
  onAvatarChange: (avatarUrl: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [isRemoving, startRemoving] = useTransition();

  function resetCropState() {
    setImageSrc(null);
    setCroppedAreaPixels(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    resetCropState();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImageSrc(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function handleSaveCrop() {
    if (!imageSrc || !croppedAreaPixels) return;
    setError(null);
    startSaving(async () => {
      try {
        const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, OUTPUT_SIZE);
        const formData = new FormData();
        formData.set("file", blob, "avatar.webp");
        const result = await uploadAvatar(formData);
        if (result.error || !result.data) {
          setError(result.error ?? "Could not upload the photo.");
          return;
        }
        onAvatarChange(result.data.avatarUrl);
        resetCropState();
      } catch {
        setError("Could not process the photo.");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startRemoving(async () => {
      const result = await removeAvatar();
      if (result.error) {
        setError(result.error);
        return;
      }
      onAvatarChange(null);
    });
  }

  if (imageSrc) {
    return (
      <Stack gap="md">
        {/* Fixed-height, `position: relative` container — `Cropper` fills
            its parent absolutely, same "size the third-party widget's
            container with an inline style" precedent already used for
            `MapContainer` in `app/(app)/assets/components/asset-map.tsx`
            (only Leaflet's other browser-only embed in this app). */}
        <div style={{ position: "relative", width: "100%", height: "280px" }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={CROP_ASPECT}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_croppedArea, pixels) => setCroppedAreaPixels(pixels)}
          />
        </div>
        <Stack gap="xs">
          <Text tone="muted">Zoom</Text>
          <Slider
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Zoom"
          />
        </Stack>
        {error && <Text tone="danger">{error}</Text>}
        <Inline gap="sm">
          <Button type="button" variant="outline" onClick={resetCropState} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSaveCrop} disabled={isSaving || !croppedAreaPixels}>
            {isSaving ? "Saving…" : "Save photo"}
          </Button>
        </Inline>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Inline gap="md" align="center">
        <Avatar name={name} size="lg" photoUrl={avatarUrl} />
        <Inline gap="sm">
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Camera aria-hidden />
            {avatarUrl ? "Change photo" : "Upload photo"}
          </Button>
          {avatarUrl && (
            <Button type="button" variant="outline" onClick={handleRemove} disabled={isRemoving}>
              <Trash2 aria-hidden />
              {isRemoving ? "Removing…" : "Remove"}
            </Button>
          )}
        </Inline>
      </Inline>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="ui-visually-hidden"
        aria-label="Upload profile photo"
      />
      {error && <Text tone="danger">{error}</Text>}
    </Stack>
  );
}
