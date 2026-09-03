"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { Button, CompanyLogo, Inline, Stack, Text } from "@yourorg/ui";
import { Building2, Camera, Trash2 } from "@yourorg/ui/icons";
import { compressLogoImage } from "./compress-logo";
import { removeClientLogo, uploadClientLogo } from "../logo-actions";

// 512px max dimension — plenty sharp for the tile sizes this app renders a
// logo at today (`CompanyLogo`'s `lg` is 80px) and for a future invoice PDF
// render, while keeping the compressed webp small. Same "generous headroom
// over any realistic current use" reasoning `AvatarUploader`'s own
// `OUTPUT_SIZE` comment gives.
const MAX_DIMENSION = 512;

/**
 * Company-card logo control on the Client detail page (issue #120) —
 * upload/replace/remove, directly modeled on `app/(app)/profile/
 * avatar-uploader.tsx`'s affordance shape but without a crop step (see
 * `compress-logo.ts`'s doc comment for why: a logo isn't force-cropped to a
 * fixed shape). Renders via `getClientLogoUrl` server-side; this component
 * only ever receives the already-resolved `logoUrl`.
 *
 * Only ever rendered when the caller already knows `canWrite` is true (same
 * `can(actor, "clients", "update")` gate `ClientDetail` already threads
 * through to its other owner-only controls, e.g. the Edit/Delete hero
 * actions) — a non-owner never sees this control, only the plain
 * `CompanyLogo` preview `client-detail.tsx` renders directly.
 */
export function ClientLogoUploader({
  clientId,
  clientName,
  logoUrl,
  onLogoChange,
}: {
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  onLogoChange: (logoUrl: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, startUploading] = useTransition();
  const [isRemoving, startRemoving] = useTransition();

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    startUploading(async () => {
      try {
        const blob = await compressLogoImage(file, MAX_DIMENSION);
        const formData = new FormData();
        formData.set("file", blob, "logo.webp");
        const result = await uploadClientLogo(clientId, formData);
        if (result.error || !result.data) {
          setError(result.error ?? "Could not upload the logo.");
          return;
        }
        onLogoChange(result.data.logoUrl);
      } catch {
        setError("Could not process the logo.");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startRemoving(async () => {
      const result = await removeClientLogo(clientId);
      if (result.error) {
        setError(result.error);
        return;
      }
      onLogoChange(null);
    });
  }

  const pending = isUploading || isRemoving;

  return (
    <Stack gap="sm">
      <Inline gap="md" align="center">
        <CompanyLogo logoUrl={logoUrl} alt={`${clientName} logo`} fallback={<Building2 />} />
        <Inline gap="sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
          >
            <Camera aria-hidden />
            {isUploading ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button type="button" variant="outline" size="sm" onClick={handleRemove} disabled={pending}>
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
        aria-label="Upload company logo"
      />
      {error && <Text tone="danger">{error}</Text>}
    </Stack>
  );
}
