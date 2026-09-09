"use client";

import { EditableSection, FormGrid, Input, KeyValueList, Label, Stack, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import type { ArticleDraft } from "./article-draft";

export interface ArticleInfoSectionProps {
  draft: Pick<ArticleDraft, "articleNumber" | "mpn" | "ean" | "gtin" | "description">;
  article: ArticleRecord;
  editing: boolean;
  /** Every field is directly controlled off the shared `draft` and writes
   * straight back through this on every change — the page's single header
   * pencil/Save pair (`article-screen.tsx`'s `pageEditing`) is the only
   * editing surface for this whole screen; there is no per-section Save here. */
  onFieldChange: (patch: Partial<Pick<ArticleDraft, "articleNumber" | "mpn" | "ean" | "gtin" | "description">>) => void;
}

/**
 * "Article" section — the article's own core identity fields (Article
 * number, MPN, EAN, GTIN, Description), same read-card/accent-edit-card
 * toggle as `AssetEquipmentSection`. `editing` is driven purely by the
 * parent's single `pageEditing` boolean (see `article-screen.tsx`'s own
 * module doc comment) — there is no independent per-section pencil/Save
 * here, and no create-vs-edit distinction: every article this section ever
 * renders for is already a real, persisted row (`CreateArticleButton`
 * creates the bare placeholder before ever navigating here).
 */
export function ArticleInfoSection({ draft, article, editing, onFieldChange }: ArticleInfoSectionProps) {
  return (
    <EditableSection
      icon={Boxes}
      title="Article"
      editing={editing}
      editLabel="Edit article"
      editContent={
        <Stack gap="md">
          <FormGrid columns={4}>
            <Stack gap="xs">
              <Label htmlFor="article-info-number">Article number *</Label>
              <Input
                id="article-info-number"
                value={draft.articleNumber}
                onChange={(event) => onFieldChange({ articleNumber: event.target.value })}
                maxLength={100}
                required
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-info-mpn">MPN (manufacturer part number)</Label>
              <Input
                id="article-info-mpn"
                value={draft.mpn}
                onChange={(event) => onFieldChange({ mpn: event.target.value })}
                maxLength={100}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-info-ean">EAN</Label>
              <Input
                id="article-info-ean"
                value={draft.ean}
                onChange={(event) => onFieldChange({ ean: event.target.value })}
                maxLength={64}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-info-gtin">GTIN</Label>
              <Input
                id="article-info-gtin"
                value={draft.gtin}
                onChange={(event) => onFieldChange({ gtin: event.target.value })}
                maxLength={64}
              />
            </Stack>
          </FormGrid>
          <Stack gap="xs">
            <Label htmlFor="article-info-description">Description *</Label>
            <Input
              id="article-info-description"
              value={draft.description}
              onChange={(event) => onFieldChange({ description: event.target.value })}
              maxLength={2000}
              required
            />
          </Stack>
        </Stack>
      }
    >
      <KeyValueList
        items={[
          { key: "number", label: "Article number", value: <Text>{article.article_number}</Text> },
          { key: "mpn", label: "MPN", value: <Text>{article.mpn ?? "—"}</Text> },
          { key: "ean", label: "EAN", value: <Text>{article.ean ?? "—"}</Text> },
          { key: "gtin", label: "GTIN", value: <Text>{article.gtin ?? "—"}</Text> },
          { key: "description", label: "Description", value: <Text>{article.description}</Text> },
        ]}
      />
    </EditableSection>
  );
}
