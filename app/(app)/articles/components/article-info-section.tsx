"use client";

import { useEffect, useState } from "react";
import { Button, EditableSection, FormGrid, Inline, Input, KeyValueList, Label, Stack, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import type { ArticleDraft } from "./article-draft";

export interface ArticleInfoSectionProps {
  mode: "create" | "edit";
  draft: Pick<ArticleDraft, "articleNumber" | "mpn" | "ean" | "gtin" | "description">;
  article?: ArticleRecord;
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ArticleDraft, "articleNumber" | "mpn" | "ean" | "gtin" | "description">,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** `mode: "edit"` only — every field becomes directly controlled off the
   * shared `draft` and writes straight back through this on every change,
   * instead of the section's own local echo state + Save button (see
   * `article-screen.tsx`'s own doc comment for why: one page-level pencil/
   * Save now owns edit mode for this whole screen). */
  onFieldChange?: (patch: Partial<Pick<ArticleDraft, "articleNumber" | "mpn" | "ean" | "gtin" | "description">>) => void;
}

/**
 * "Article" section (issue #123, converting the old `ArticleFormPanel` slide-in
 * into a real page) — the article's own core identity fields (Article number,
 * MPN, EAN, GTIN, Description), same read-card/accent-edit-card toggle as
 * `AssetEquipmentSection`. Always `editing` in `mode: "create"` (Article
 * number/Description are the only two hard-required fields — same "always
 * open, no Cancel" treatment `AssetEquipmentSection` gives its own Type field)
 * — every other section on this screen can be freely opened/closed even
 * while creating, since none of their own fields are required to save.
 *
 * `mode: "edit"` no longer owns its own Save/Cancel — see `onFieldChange`
 * above and `article-screen.tsx`'s module doc comment.
 */
export function ArticleInfoSection({ mode, draft, article, editing, onEditToggle, readOnly, onSave, onFieldChange }: ArticleInfoSectionProps) {
  const [articleNumber, setArticleNumber] = useState(draft.articleNumber);
  const [mpn, setMpn] = useState(draft.mpn);
  const [ean, setEan] = useState(draft.ean);
  const [gtin, setGtin] = useState(draft.gtin);
  const [description, setDescription] = useState(draft.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setArticleNumber(draft.articleNumber);
    setMpn(draft.mpn);
    setEan(draft.ean);
    setGtin(draft.gtin);
    setDescription(draft.description);
    setError(null);
    // Only re-seed on the open transition itself, not on every draft change
    // while already open — same "open re-seeds, not every keystroke"
    // contract every other inline edit in this codebase follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function handleSave() {
    if (!articleNumber.trim()) {
      setError("Article number is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ articleNumber, mpn, ean, gtin, description });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  return (
    <EditableSection
      icon={Boxes}
      title="Article"
      editing={editing}
      onEdit={mode === "edit" || readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit article"
      editContent={
        mode === "edit" ? (
          <Stack gap="md">
            <FormGrid columns={4}>
              <Stack gap="xs">
                <Label htmlFor="article-info-number">Article number *</Label>
                <Input
                  id="article-info-number"
                  value={draft.articleNumber}
                  onChange={(event) => onFieldChange?.({ articleNumber: event.target.value })}
                  maxLength={100}
                  required
                />
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="article-info-mpn">MPN (manufacturer part number)</Label>
                <Input
                  id="article-info-mpn"
                  value={draft.mpn}
                  onChange={(event) => onFieldChange?.({ mpn: event.target.value })}
                  maxLength={100}
                />
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="article-info-ean">EAN</Label>
                <Input
                  id="article-info-ean"
                  value={draft.ean}
                  onChange={(event) => onFieldChange?.({ ean: event.target.value })}
                  maxLength={64}
                />
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="article-info-gtin">GTIN</Label>
                <Input
                  id="article-info-gtin"
                  value={draft.gtin}
                  onChange={(event) => onFieldChange?.({ gtin: event.target.value })}
                  maxLength={64}
                />
              </Stack>
            </FormGrid>
            <Stack gap="xs">
              <Label htmlFor="article-info-description">Description *</Label>
              <Input
                id="article-info-description"
                value={draft.description}
                onChange={(event) => onFieldChange?.({ description: event.target.value })}
                maxLength={2000}
                required
              />
            </Stack>
          </Stack>
        ) : (
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}
            <FormGrid columns={4}>
              <Stack gap="xs">
                <Label htmlFor="article-info-number">Article number *</Label>
                <Input
                  id="article-info-number"
                  value={articleNumber}
                  onChange={(event) => setArticleNumber(event.target.value)}
                  maxLength={100}
                  required
                />
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="article-info-mpn">MPN (manufacturer part number)</Label>
                <Input id="article-info-mpn" value={mpn} onChange={(event) => setMpn(event.target.value)} maxLength={100} />
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="article-info-ean">EAN</Label>
                <Input id="article-info-ean" value={ean} onChange={(event) => setEan(event.target.value)} maxLength={64} />
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="article-info-gtin">GTIN</Label>
                <Input id="article-info-gtin" value={gtin} onChange={(event) => setGtin(event.target.value)} maxLength={64} />
              </Stack>
            </FormGrid>
            <Stack gap="xs">
              <Label htmlFor="article-info-description">Description *</Label>
              <Input
                id="article-info-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                required
              />
            </Stack>
            <Inline gap="sm" justify="end">
              <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </Inline>
          </Stack>
        )
      }
    >
      <KeyValueList
        items={[
          { key: "number", label: "Article number", value: <Text>{article?.article_number ?? "—"}</Text> },
          { key: "mpn", label: "MPN", value: <Text>{article?.mpn ?? "—"}</Text> },
          { key: "ean", label: "EAN", value: <Text>{article?.ean ?? "—"}</Text> },
          { key: "gtin", label: "GTIN", value: <Text>{article?.gtin ?? "—"}</Text> },
          { key: "description", label: "Description", value: <Text>{article?.description ?? "—"}</Text> },
        ]}
      />
    </EditableSection>
  );
}
