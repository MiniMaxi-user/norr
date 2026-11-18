"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog, Slider, toast, useEscapeToClose } from "@yourorg/ui";
import { Camera } from "@yourorg/ui/icons";
import { WebButton } from "@yourorg/ui/web";
import { WebMenu } from "@yourorg/ui/web-client";
import { getCroppedImageBlob } from "./crop-image";
import { removeAvatar, uploadAvatar } from "./actions";

const CROP_ASPECT = 1;
// 512px keeps the exported webp small (the crop always starts from the
// user's already-cropped, largely-headshot-sized selection) while still
// looking sharp at any size this app renders an avatar.
const OUTPUT_SIZE = 512;

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function AvatarImage({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  if (!avatarUrl) {
    return (
      <span aria-hidden="true" style={{ font: "600 16px/1 var(--font-sans)", color: "var(--text-secondary)" }}>
        {initialsOf(name)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={avatarUrl} alt={`${name} photo`} />;
}

/**
 * Photo slot of the Profile page header (web design system, issue #222; before:
 * the "Photo" section of the profile slide-over). Read mode shows the photo (or
 * the initials); in edit mode the slot becomes a menu to upload/change/remove
 * it, exactly like the client logo slot. The select, crop (round frame, zoom)
 * and upload flow is unchanged: a chosen file opens a crop dialog, "Save photo"
 * uploads the cropped webp. Photo changes persist immediately (independent of
 * the Save button), so they are never part of the "unsaved changes" count.
 */
export function ProfileAvatarSlot({
  name,
  avatarUrl,
  onAvatarChange,
  editable,
}: {
  name: string;
  avatarUrl: string | null;
  onAvatarChange: (avatarUrl: string | null) => void;
  editable: boolean;
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

  function closeDialog() {
    if (isSaving) return;
    setError(null);
    resetCropState();
  }
  useEscapeToClose(Boolean(imageSrc), (open) => {
    if (!open) closeDialog();
  });

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Photo not changed", description: "Choose an image file (PNG, JPG or WebP).", tone: "danger", duration: 6000 });
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
          setError(result.error ?? "Could not upload the photo. Try again.");
          return;
        }
        onAvatarChange(result.data.avatarUrl);
        resetCropState();
        toast({ title: "Photo saved", tone: "success", duration: 3000 });
      } catch {
        setError("Could not process the photo. Try another file.");
      }
    });
  }

  function handleRemove() {
    startRemoving(async () => {
      const result = await removeAvatar();
      if (result.error) {
        toast({ title: "Photo not removed", description: result.error, tone: "danger", duration: 6000 });
        return;
      }
      onAvatarChange(null);
    });
  }

  if (!editable && !imageSrc) return <AvatarImage avatarUrl={avatarUrl} name={name} />;

  const pending = isSaving || isRemoving;
  return (
    <>
      {editable ? (
        <WebMenu
          label={avatarUrl ? "Change photo" : "Upload photo"}
          align="start"
          triggerClassName="web-logo-trigger"
          trigger={
            <>
              <AvatarImage avatarUrl={avatarUrl} name={name} />
              <span className="web-logo-trigger-badge" aria-hidden="true">
                <Camera />
              </span>
            </>
          }
          items={[
            {
              key: "upload",
              label: isRemoving ? "Removing…" : avatarUrl ? "Change photo" : "Upload photo",
              disabled: pending,
              onSelect: () => fileInputRef.current?.click(),
            },
            ...(avatarUrl
              ? [{ key: "remove", label: "Remove photo", danger: true, disabled: pending, onSelect: handleRemove }]
              : []),
          ]}
        />
      ) : (
        <AvatarImage avatarUrl={avatarUrl} name={name} />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="ui-visually-hidden"
        aria-label="Upload profile photo"
        tabIndex={-1}
      />

      <Dialog open={Boolean(imageSrc)} onOpenChange={(next) => !next && closeDialog()} size="sm">
        <Dialog.Header>
          <h2 className="web-dialog-title">Crop photo</h2>
        </Dialog.Header>
        <Dialog.Body>
          {/* Fixed-height, `position: relative` container — `Cropper` fills its
              parent absolutely. */}
          <div style={{ position: "relative", width: "100%", height: "280px" }}>
            {imageSrc ? (
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
            ) : null}
          </div>
          <div className="web-dialog-text">
            <label htmlFor="profile-photo-zoom">Zoom</label>
            <Slider
              id="profile-photo-zoom"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              aria-label="Zoom"
            />
          </div>
          {error ? (
            <p className="web-dialog-error" role="alert">
              <span className="web-error-mark" aria-hidden="true">
                !
              </span>
              {error}
            </p>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <WebButton onClick={closeDialog} disabled={isSaving}>
            Cancel
          </WebButton>
          <WebButton variant="save" loading={isSaving} disabled={!croppedAreaPixels} onClick={handleSaveCrop}>
            {isSaving ? "Saving…" : "Save photo"}
          </WebButton>
        </Dialog.Footer>
      </Dialog>
    </>
  );
}
