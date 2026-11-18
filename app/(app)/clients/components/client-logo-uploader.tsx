"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { toast } from "@yourorg/ui";
import { Building2, Camera } from "@yourorg/ui/icons";
import { WebMenu } from "@yourorg/ui/web-client";
import { compressLogoImage } from "./compress-logo";
import { removeClientLogo, uploadClientLogo } from "../logo-actions";

// 512px max dimension — plenty sharp for the tile sizes this app renders a
// logo at today and for the invoice PDF render, while keeping the compressed
// PNG small.
const MAX_DIMENSION = 512;

function LogoImage({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (!logoUrl) return <Building2 aria-hidden style={{ width: 22, height: 22, color: "var(--text-muted)" }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logoUrl} alt={`${name} logo`} />;
}

/**
 * Logo slot of the Client page header (design system "PageHeader", issue
 * #222; before: a separate "Company" rail card). Read mode shows the logo (or
 * a neutral building glyph); in edit mode — only for someone who can update
 * the client (`editable`) — the slot becomes a menu to upload/replace/remove
 * it. Uploads go straight through `uploadClientLogo`/`removeClientLogo` (they
 * persist to storage immediately, independent of the Save button — same as
 * before issue #222), so a logo change is never part of the "unsaved changes"
 * count. Not offered on the new-client page: a logo needs the client's id.
 */
export function ClientLogoSlot({
  clientId,
  clientName,
  logoUrl,
  onLogoChange,
  editable,
}: {
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  onLogoChange: (logoUrl: string | null) => void;
  editable: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUploading] = useTransition();
  const [isRemoving, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fail(message: string) {
    setError(message);
    toast({ title: "Logo not changed", description: message, tone: "danger", duration: 6000 });
  }

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      fail("Choose an image file (PNG, JPG or SVG).");
      return;
    }
    setError(null);
    startUploading(async () => {
      try {
        const blob = await compressLogoImage(file, MAX_DIMENSION);
        const formData = new FormData();
        formData.set("file", blob, "logo.png");
        const result = await uploadClientLogo(clientId, formData);
        if (result.error || !result.data) {
          fail(result.error ?? "Could not upload the logo. Try again.");
          return;
        }
        onLogoChange(result.data.logoUrl);
      } catch {
        fail("Could not process this image. Try another file.");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startRemoving(async () => {
      const result = await removeClientLogo(clientId);
      if (result.error) {
        fail(result.error);
        return;
      }
      onLogoChange(null);
    });
  }

  if (!editable) return <LogoImage logoUrl={logoUrl} name={clientName} />;

  const pending = isUploading || isRemoving;
  return (
    <>
      <WebMenu
        label={logoUrl ? "Change logo" : "Upload logo"}
        align="start"
        triggerClassName="web-logo-trigger"
        trigger={
          <>
            <LogoImage logoUrl={logoUrl} name={clientName} />
            <span className="web-logo-trigger-badge" aria-hidden="true">
              <Camera />
            </span>
          </>
        }
        items={[
          {
            key: "upload",
            label: pending ? (isUploading ? "Uploading…" : "Removing…") : logoUrl ? "Change logo" : "Upload logo",
            disabled: pending,
            onSelect: () => fileInputRef.current?.click(),
          },
          ...(logoUrl
            ? [{ key: "remove", label: "Remove logo", danger: true, disabled: pending, onSelect: handleRemove }]
            : []),
        ]}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="ui-visually-hidden"
        aria-label="Upload company logo"
        tabIndex={-1}
      />
      {error ? (
        <span className="ui-visually-hidden" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
