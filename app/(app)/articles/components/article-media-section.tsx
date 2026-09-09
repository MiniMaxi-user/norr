"use client";

import { EditableSection, Input, Label, MediaTile, Stack, Text } from "@yourorg/ui";
import { Camera } from "@yourorg/ui/icons";
import type { ArticleDraft } from "./article-draft";

export interface ArticleMediaSectionProps {
  draft: Pick<ArticleDraft, "imageUrl">;
  articleNumber?: string;
  editing: boolean;
  /** See `ArticleInfoSectionProps.onFieldChange`'s own doc comment. */
  onFieldChange: (patch: Partial<Pick<ArticleDraft, "imageUrl">>) => void;
}

/**
 * "Photo" section ("zorg dat de foto van het artikel op een mooie plek
 * verwerkt is" — the product owner's specific ask for a well-placed photo,
 * replacing the old `ArticleFormPanel`'s plain "Image URL" text field + small
 * live `<img>` preview). Sits at the top of the detail screen's right
 * column, directly under the hero band — the first thing a caller sees below
 * the fold.
 *
 * Still just a free-text URL under the hood (no upload handling — same scope
 * boundary `articleCreateSchema.imageUrl`'s own doc comment states), but
 * rendered through the shared `MediaTile` primitive (`packages/ui`) instead
 * of a bare `<img>` — a large, bordered, contain-fit tile with a `Camera`
 * fallback icon when empty, matching every other "photo/logo tile" surface
 * in this design system (`Avatar`/`CompanyLogo`). Same read-card/accent-
 * edit-card toggle as every other section on this screen, `editing` driven
 * purely by the parent's single `pageEditing` boolean (see
 * `article-screen.tsx`'s own module doc comment) — no per-section pencil/
 * Save here.
 */
export function ArticleMediaSection({ draft, articleNumber, editing, onFieldChange }: ArticleMediaSectionProps) {
  const alt = articleNumber ? `${articleNumber} photo` : "Article photo";

  return (
    <EditableSection
      icon={Camera}
      title="Photo"
      editing={editing}
      editLabel="Edit photo"
      editContent={
        <Stack gap="md">
          <MediaTile size="xl" imageUrl={draft.imageUrl.trim() || undefined} alt={alt} fallback={<Camera />} />
          <Stack gap="xs">
            <Label htmlFor="article-media-url">Image URL</Label>
            <Input
              id="article-media-url"
              value={draft.imageUrl}
              onChange={(event) => onFieldChange({ imageUrl: event.target.value })}
              maxLength={2000}
              placeholder="https://…"
            />
          </Stack>
        </Stack>
      }
    >
      <Stack gap="sm">
        <MediaTile size="xl" imageUrl={draft.imageUrl || undefined} alt={alt} fallback={<Camera />} />
        {!draft.imageUrl && <Text tone="muted">No photo added</Text>}
      </Stack>
    </EditableSection>
  );
}
