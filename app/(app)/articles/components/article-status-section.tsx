"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, CompositionTree, EditableSection, Heading, Inline, Label, Stack, Text } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ArticleComponentLineRecord, ArticleRecord } from "../actions";
import type { ArticleComponentTreeNode } from "../component-tree";
import type { ArticleDraft } from "./article-draft";
import { ArticleComponentsEditor } from "./article-components-editor";

export interface ArticleStatusSectionProps {
  mode: "create" | "edit";
  draft: Pick<ArticleDraft, "isActive" | "isComposite">;
  article?: ArticleRecord;
  /** `getArticle`'s own BOM lines, fetched server-side alongside the article
   * itself — `mode: "edit"` only, `undefined` in `mode: "create"` (nothing to
   * fetch yet). */
  components?: ArticleComponentLineRecord[];
  /** `getArticleComponentTree`'s full recursive descendant tree, rooted at
   * this article — `mode: "edit"` and `article.is_composite === true` only
   * (see `ArticleScreenProps.componentTree`'s own doc comment). */
  componentTree?: ArticleComponentTreeNode;
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (patch: Pick<ArticleDraft, "isActive" | "isComposite">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Status & composite" section (issue #123, converting the old
 * `ArticleFormPanel` slide-in) — the Active/Composite checkboxes, same
 * read-card/accent-edit-card toggle as every other section on this screen,
 * plus the bill-of-materials editor for a composite article rendered as a
 * SIBLING block below the toggle-able card (not itself gated by `editing`):
 * `ArticleComponentsEditor` is its own persistent management surface (add/
 * remove/re-quantity a BOM line, each already its own immediate save), not a
 * form field that needs a page-wide Save/Cancel around it.
 *
 * This considerably simplifies the old panel's `is_composite`-persistence
 * sequencing (`isCompositePersisted`/`keepOpen`/`bomUnlockedThisSession`,
 * all now deleted): that dance existed purely to avoid a close-then-reopen
 * round trip on a slide-in `Dialog` that could only ever mount `article`
 * fresh once. On a real page, `mode: "create"`'s `handleCreate` (`../
 * components/article-screen.tsx`) already navigates to `/articles/[id]` the
 * moment the article is first persisted — by the time this section ever
 * renders with `mode: "edit"`, `article.is_composite` already reflects
 * whatever the create form's Composite checkbox was checked to, so the BOM
 * editor is simply available immediately, no special-cased "first save that
 * unlocks it" banner needed. The one remaining sequencing case — an EXISTING
 * non-composite article's Composite box being checked for the first time —
 * still needs a save+`router.refresh()` round trip before `article.is_composite`
 * flips server-side and the editor appears (below), same as any other
 * inline-editable field on this screen.
 */
export function ArticleStatusSection({
  mode,
  draft,
  article,
  components,
  componentTree,
  editing,
  onEditToggle,
  readOnly,
  onSave,
}: ArticleStatusSectionProps) {
  const [isActive, setIsActive] = useState(draft.isActive);
  const [isComposite, setIsComposite] = useState(draft.isComposite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setIsActive(draft.isActive);
    setIsComposite(draft.isComposite);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handleCancel() {
    setIsActive(draft.isActive);
    setIsComposite(draft.isComposite);
    setError(null);
    if (mode === "edit") onEditToggle?.(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ isActive, isComposite });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  // The real gate for the BOM editor — the article's own PERSISTED
  // `is_composite`, not the (possibly not-yet-saved) local checkbox state
  // above. See this component's own module doc comment.
  const isCompositePersisted = mode === "edit" && article?.is_composite === true;

  return (
    <Stack gap="lg">
      <EditableSection
        icon={FileText}
        title="Status & composite"
        editing={editing}
        onEdit={readOnly ? undefined : () => onEditToggle?.(true)}
        editLabel="Edit status"
        editContent={
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}
            <Inline gap="sm" align="center">
              <Checkbox id="article-status-active" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              <Label htmlFor="article-status-active">Active</Label>
            </Inline>
            <Inline gap="sm" align="center">
              <Checkbox
                id="article-status-composite"
                checked={isComposite}
                onChange={(event) => setIsComposite(event.target.checked)}
              />
              <Label htmlFor="article-status-composite">Composite article (has a bill of materials)</Label>
            </Inline>
            <Inline gap="sm" justify="end">
              {mode === "edit" && (
                <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                  Cancel
                </Button>
              )}
              <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </Inline>
          </Stack>
        }
      >
        <Inline gap="xs">
          <Badge variant={article?.is_active ?? draft.isActive ? "success" : "muted"}>
            {(article?.is_active ?? draft.isActive) ? "Active" : "Inactive"}
          </Badge>
          {(article?.is_composite ?? draft.isComposite) && <Badge variant="accent">Composite</Badge>}
        </Inline>
      </EditableSection>

      {draft.isComposite && (
        <Stack gap="sm">
          <Heading level={4}>Bill of materials</Heading>
          {mode === "create" ? (
            <Text tone="muted">Create this article first to start adding bill-of-materials components.</Text>
          ) : !isCompositePersisted ? (
            <Text tone="muted">Save your changes above first to start adding components.</Text>
          ) : (
            <Stack gap="md">
              {componentTree && (
                <CompositionTree
                  root={componentTree}
                  getChildren={(node) => node.children}
                  getKey={(node) => node.componentId ?? node.article.id}
                  renderNode={(node) => <ArticleComponentTreeNodeContent node={node} />}
                />
              )}
              <ArticleComponentsEditor parentArticleId={article!.id} initialComponents={components ?? []} readOnly={readOnly} />
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * One `CompositionTree` node's card content for an Article's bill-of-
 * materials (issue #124) — the root node (`componentId: null`, this
 * article itself) shows no quantity badge (its `quantity: 1` is a
 * placeholder, not a real BOM-line value); every descendant shows the
 * quantity of it one unit of its own parent consumes.
 */
function ArticleComponentTreeNodeContent({ node }: { node: ArticleComponentTreeNode }) {
  return (
    <Inline gap="xs" align="center" wrap>
      <Text className="ui-row-title">{node.article.article_number}</Text>
      <Text tone="muted">{node.article.description}</Text>
      {!node.article.is_active && <Badge variant="muted">Inactive</Badge>}
      {node.article.is_composite && <Badge variant="accent">Composite</Badge>}
      {node.componentId !== null && (
        <Badge variant="muted">
          ×{node.quantity}
          {node.article.article_unit ? ` ${node.article.article_unit.label}` : ""}
        </Badge>
      )}
    </Inline>
  );
}
