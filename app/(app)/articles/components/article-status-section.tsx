"use client";

import { Badge, Checkbox, CompositionTree, EditableSection, Heading, Inline, Label, Stack, Text } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ArticleComponentLineRecord, ArticleRecord } from "../actions";
import type { ArticleComponentTreeNode } from "../component-tree";
import type { ArticleDraft } from "./article-draft";
import { ArticleComponentsEditor } from "./article-components-editor";

export interface ArticleStatusSectionProps {
  draft: Pick<ArticleDraft, "isActive" | "isComposite">;
  article: ArticleRecord;
  /** `getArticle`'s own BOM lines, fetched server-side alongside the article
   * itself. */
  components?: ArticleComponentLineRecord[];
  /** `getArticleComponentTree`'s full recursive descendant tree, rooted at
   * this article — `article.is_composite === true` only (see
   * `ArticleScreenProps.componentTree`'s own doc comment). */
  componentTree?: ArticleComponentTreeNode;
  editing: boolean;
  /** Still needed here (unlike every other Article section) — forwarded
   * straight through to `ArticleComponentsEditor`, which is its own
   * persistent management surface below the toggle-able card (see this
   * component's own module doc comment), not gated by `editing` itself. */
  readOnly?: boolean;
  /** See `ArticleInfoSectionProps.onFieldChange`'s own doc comment. */
  onFieldChange: (patch: Partial<Pick<ArticleDraft, "isActive" | "isComposite">>) => void;
}

/**
 * "Status & composite" section — the Active/Composite checkboxes, same
 * read-card/accent-edit-card toggle as every other section on this screen
 * (`editing` driven purely by the parent's single `pageEditing` boolean, see
 * `article-screen.tsx`'s own module doc comment — no per-section pencil/Save
 * here), plus the bill-of-materials editor for a composite article rendered
 * as a SIBLING block below the toggle-able card (not itself gated by
 * `editing`): `ArticleComponentsEditor` is its own persistent management
 * surface (add/remove/re-quantity a BOM line, each already its own
 * immediate save), not a form field that needs the page-wide Save/Cancel
 * around it.
 *
 * This considerably simplifies the old panel's `is_composite`-persistence
 * sequencing (`isCompositePersisted`/`keepOpen`/`bomUnlockedThisSession`,
 * all long deleted): that dance existed purely to avoid a close-then-reopen
 * round trip on a slide-in `Dialog` that could only ever mount `article`
 * fresh once. On a real page, every article this section ever renders for is
 * already a real, persisted row (`CreateArticleButton` creates the bare
 * placeholder before ever navigating here — see `article-screen.tsx`'s own
 * module doc comment), so `article.is_composite` always already reflects
 * whatever the Composite checkbox was last saved to, and the BOM editor is
 * simply available immediately whenever it's `true` — no special-cased
 * "first save that unlocks it" banner needed. The one remaining sequencing
 * case — an existing non-composite article's Composite box being checked for
 * the first time — still needs a save+`router.refresh()` round trip (the
 * page's own single Save) before `article.is_composite` flips server-side
 * and the editor appears (below).
 */
export function ArticleStatusSection({
  draft,
  article,
  components,
  componentTree,
  editing,
  readOnly,
  onFieldChange,
}: ArticleStatusSectionProps) {
  // The real gate for the BOM editor — the article's own PERSISTED
  // `is_composite`, not the (possibly not-yet-saved) local checkbox state
  // above. See this component's own module doc comment.
  const isCompositePersisted = article.is_composite === true;

  return (
    <Stack gap="lg">
      <EditableSection
        icon={FileText}
        title="Status & composite"
        editing={editing}
        editLabel="Edit status"
        editContent={
          <Stack gap="md">
            <Inline gap="sm" align="center">
              <Checkbox
                id="article-status-active"
                checked={draft.isActive}
                onChange={(event) => onFieldChange({ isActive: event.target.checked })}
              />
              <Label htmlFor="article-status-active">Active</Label>
            </Inline>
            <Inline gap="sm" align="center">
              <Checkbox
                id="article-status-composite"
                checked={draft.isComposite}
                onChange={(event) => onFieldChange({ isComposite: event.target.checked })}
              />
              <Label htmlFor="article-status-composite">Composite article (has a bill of materials)</Label>
            </Inline>
          </Stack>
        }
      >
        <Inline gap="xs">
          <Badge variant={article.is_active ? "success" : "muted"}>{article.is_active ? "Active" : "Inactive"}</Badge>
          {article.is_composite && <Badge variant="accent">Composite</Badge>}
        </Inline>
      </EditableSection>

      {draft.isComposite && (
        <Stack gap="sm">
          <Heading level={4}>Bill of materials</Heading>
          {!isCompositePersisted ? (
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
              <ArticleComponentsEditor parentArticleId={article.id} initialComponents={components ?? []} readOnly={readOnly} />
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
