"use client";

import { useEffect, useState } from "react";
import { Button, EditableSection, Inline, Input, Label, MediaTile, Stack, Text } from "@yourorg/ui";
import { Camera } from "@yourorg/ui/icons";
import type { ArticleDraft } from "./article-draft";

export interface ArticleMediaSectionProps {
  mode: "create" | "edit";
  draft: Pick<ArticleDraft, "imageUrl">;
  articleNumber?: string;
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (patch: Pick<ArticleDraft, "imageUrl">) => Promise<{ ok: boolean; error?: string }>;
  /** `mode: "edit"` only — see `ArticleInfoSectionProps.onFieldChange`'s own
   * doc comment. */
  onFieldChange?: (patch: Partial<Pick<ArticleDraft, "imageUrl">>) => void;
}

/**
 * "Photo" section (issue #123, "zorg dat de foto van het artikel op een mooie
 * plek verwerkt is" — the product owner's specific ask for a well-placed
 * photo, replacing the old `ArticleFormPanel`'s plain "Image URL" text field +
 * small live `<img>` preview). Sits at the top of the detail screen's right
 * column, directly under the hero band — the first thing a caller sees below
 * the fold, same "hero-adjacent" placement the issue asked for.
 *
 * Still just a free-text URL under the hood (no upload handling — same scope
 * boundary `articleCreateSchema.imageUrl`'s own doc comment states), but
 * rendered through the shared `MediaTile` primitive (`packages/ui`, added in
 * this same pass) instead of a bare `<img>` — a large, bordered, contain-fit
 * tile with a `Camera` fallback icon when empty, matching every other
 * "photo/logo tile" surface in this design system (`Avatar`/`CompanyLogo`).
 * Same read-card/accent-edit-card toggle as every other section on this
 * screen; unlike `ArticleInfoSection`, this one stays freely closeable even
 * in `mode: "create"` (a photo is optional, same "not one of the hard
 * requirements" reasoning `AssetNotesSection` documents for its own default-
 * closed state).
 */
export function ArticleMediaSection({
  mode,
  draft,
  articleNumber,
  editing,
  onEditToggle,
  readOnly,
  onSave,
  onFieldChange,
}: ArticleMediaSectionProps) {
  const [imageUrl, setImageUrl] = useState(draft.imageUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setImageUrl(draft.imageUrl);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setImageUrl(draft.imageUrl);
    setError(null);
    onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ imageUrl });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onEditToggle?.(false);
  }

  const alt = articleNumber ? `${articleNumber} photo` : "Article photo";

  return (
    <EditableSection
      icon={Camera}
      title="Photo"
      editing={editing}
      onEdit={mode === "edit" || readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit photo"
      editContent={
        mode === "edit" ? (
          <Stack gap="md">
            <MediaTile size="xl" imageUrl={draft.imageUrl.trim() || undefined} alt={alt} fallback={<Camera />} />
            <Stack gap="xs">
              <Label htmlFor="article-media-url">Image URL</Label>
              <Input
                id="article-media-url"
                value={draft.imageUrl}
                onChange={(event) => onFieldChange?.({ imageUrl: event.target.value })}
                maxLength={2000}
                placeholder="https://…"
              />
            </Stack>
          </Stack>
        ) : (
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}
            <MediaTile size="xl" imageUrl={imageUrl.trim() || undefined} alt={alt} fallback={<Camera />} />
            <Stack gap="xs">
              <Label htmlFor="article-media-url">Image URL</Label>
              <Input
                id="article-media-url"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                maxLength={2000}
                placeholder="https://…"
              />
            </Stack>
            <Inline gap="sm" justify="end">
              <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </Inline>
          </Stack>
        )
      }
    >
      <Stack gap="sm">
        <MediaTile size="xl" imageUrl={draft.imageUrl || undefined} alt={alt} fallback={<Camera />} />
        {!draft.imageUrl && <Text tone="muted">{mode === "create" ? "No photo yet" : "No photo added"}</Text>}
      </Stack>
    </EditableSection>
  );
}
