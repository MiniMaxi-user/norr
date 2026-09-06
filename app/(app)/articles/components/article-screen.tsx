"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs, Button, DetailColumns, Stack, Text, type BreadcrumbItem } from "@yourorg/ui";
import { createArticle, updateArticle, type ArticleComponentLineRecord, type ArticleRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { FlattenedArticleGroup } from "../group-tree";
import type { ArticleComponentTreeNode } from "../component-tree";
import { usePageHeader } from "@/components/shell/page-header-context";
import { ArticleDetailActions } from "../[id]/article-detail-actions";
import { ArticleHero } from "./article-hero";
import { ArticleInfoSection } from "./article-info-section";
import { ArticleMediaSection } from "./article-media-section";
import { ArticleClassificationSection } from "./article-classification-section";
import { ArticlePricingSection } from "./article-pricing-section";
import { ArticleStatusSection } from "./article-status-section";
import { draftFromArticle, draftToInput, emptyDraft, type ArticleDraft } from "./article-draft";

export interface ArticleScreenProps {
  mode: "create" | "edit";
  /** Built by the server `page.tsx` and pushed into the Topbar via
   * `usePageHeader` — never rendered inline in the page body, matching
   * `client-detail.tsx`/`WorkOrderScreen`/`ActivityScreen`'s own pattern. */
  breadcrumbItems: BreadcrumbItem[];

  /** Required for `mode: "edit"`. */
  article?: ArticleRecord;
  /** `getArticle`'s own BOM lines — `mode: "edit"` only. */
  components?: ArticleComponentLineRecord[];
  /** `getArticleComponentTree`'s full recursive descendant tree, rooted at
   * this article — `mode: "edit"` and `article.is_composite === true` only
   * (see `loadArticleScreenProps`'s own gate); `undefined` otherwise. Fetched
   * server-side alongside `article`/`components`, same "passed down from the
   * page, fetched once" shape every other prop on this screen already
   * follows (issue #124). */
  componentTree?: ArticleComponentTreeNode;
  /** Never render an edit affordance RLS would reject — a `planner`/
   * `engineer`/`finance` viewer (plain `read`, per `lib/rbac/permissions.ts`'s
   * `articles` entry) gets a fully read-only render (no pencils anywhere),
   * same convention `AssetScreen`'s own `readOnly` documents. */
  readOnly?: boolean;
  /** The org's whole flattened Article Group tree, plus the `article_unit`/
   * `article_manufacturer`/`vat_rate` reference lists — fetched once by the
   * server `page.tsx` and passed down, same "passed down from the page,
   * fetched once" shape `ArticlesScreen` already uses for the list view. */
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
  cancelHref?: string;

  canDelete?: boolean;
}

/**
 * The single shared screen behind `/articles/new` (`mode: "create"`),
 * `/articles/[id]` and `/articles/[id]/edit` (`mode: "edit"`, identical props
 * — NOT a distinct third mode; see both those routes' own `page.tsx`) — one
 * real screen, not three, replacing the old `ArticleFormPanel` slide-in
 * (issue #123, "Article popup" — see `docs/ARCHITECTURE.md`'s "Popup vs. full
 * page" section for the history). Mirrors `AssetScreen`'s per-section
 * `EditableSection` shape rather than `ActivityScreen`'s "relation cards +
 * dialogs" one: an Article has no client/site/model relation of its own to
 * surface as a `RelationCard`, so there's nothing here that needs a small
 * edit-popup — every field is a plain value grouped into one of five flat
 * sections (Article / Photo / Classification / Pricing & VAT / Status &
 * composite), each independently inline-editable in place.
 *
 * Owns one flat `ArticleDraft` (`./article-draft.ts`) as the source of truth
 * for every editable field; every section reads from it and writes back
 * through `commitPatch` below — in `mode: "edit"` that's an immediate
 * `updateArticle` call (small, section-scoped, saved the instant that
 * section's own Save is clicked — no page-wide Save/Cancel), in
 * `mode: "create"` it's a local-only merge until the hero's own "Create
 * article" action fires `createArticle` with the whole accumulated draft and
 * navigates to the new record — same split `AssetScreen`/`ActivityScreen`
 * both document for themselves.
 *
 * Only the "Article" section (Article number + Description, the two hard-
 * required fields) is forced open for the whole `mode: "create"` flow, same
 * "always open, no Cancel" treatment `AssetEquipmentSection` gives its own
 * required Type field — every other section stays freely open/closeable even
 * while creating, since none of their own fields are required to save.
 */
export function ArticleScreen({
  mode,
  breadcrumbItems,
  article,
  components,
  componentTree,
  readOnly,
  groups,
  units,
  manufacturers,
  vatRates,
  cancelHref,
  canDelete,
}: ArticleScreenProps) {
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<ArticleDraft>(() => (article ? draftFromArticle(article) : emptyDraft()));

  // ---- Section edit-open state (see this component's own doc comment) ----
  const [infoEditing, setInfoEditing] = useState(true);
  const [mediaEditing, setMediaEditing] = useState(false);
  const [classificationEditing, setClassificationEditing] = useState(mode === "create");
  const [pricingEditing, setPricingEditing] = useState(mode === "create");
  const [statusEditing, setStatusEditing] = useState(mode === "create");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Every section's own "Save" ultimately calls this. `mode: "edit"`
   * persists immediately (`updateArticle`) and refreshes the server-rendered
   * data; `mode: "create"` only ever merges into local draft state. */
  async function commitPatch(patch: Partial<ArticleDraft>): Promise<{ ok: boolean; error?: string }> {
    if (mode === "edit" && article) {
      const result = await updateArticle(article.id, draftToInput(patch));
      if (!result.data) return { ok: false, error: result.error };
      setDraft((prev) => ({ ...prev, ...patch }));
      router.refresh();
      return { ok: true };
    }
    setDraft((prev) => ({ ...prev, ...patch }));
    return { ok: true };
  }

  async function handleCreate() {
    if (!draft.articleNumber.trim()) {
      setCreateError("Article number is required.");
      setInfoEditing(true);
      return;
    }
    if (!draft.description.trim()) {
      setCreateError("Description is required.");
      setInfoEditing(true);
      return;
    }
    setCreateError(null);
    setCreating(true);
    const result = await createArticle(draftToInput(draft));
    setCreating(false);
    if (!result.data) {
      setCreateError(result.error ?? "Could not create this article.");
      return;
    }
    router.push(`/articles/${result.data.article.id}`);
  }

  const heroActions =
    mode === "edit" && article ? (
      <ArticleDetailActions article={article} canDelete={Boolean(canDelete)} />
    ) : (
      <>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(cancelHref ?? "/articles")}
          disabled={creating}
        >
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Creating…" : "Create article"}
        </Button>
      </>
    );

  return (
    <Stack gap="lg">
      {createError && <Text tone="danger">{createError}</Text>}

      <ArticleHero mode={mode} draft={draft} article={article} groups={groups} actions={heroActions} />

      <DetailColumns
        left={
          <>
            <ArticleInfoSection
              mode={mode}
              draft={draft}
              article={article}
              editing={infoEditing}
              onEditToggle={setInfoEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />

            <ArticlePricingSection
              mode={mode}
              draft={draft}
              article={article}
              vatRates={vatRates}
              editing={pricingEditing}
              onEditToggle={setPricingEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />

            <ArticleStatusSection
              mode={mode}
              draft={draft}
              article={article}
              components={components}
              componentTree={componentTree}
              editing={statusEditing}
              onEditToggle={setStatusEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
          </>
        }
        right={
          <>
            <ArticleMediaSection
              mode={mode}
              draft={draft}
              articleNumber={draft.articleNumber || undefined}
              editing={mediaEditing}
              onEditToggle={setMediaEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />

            <ArticleClassificationSection
              mode={mode}
              draft={draft}
              article={article}
              groups={groups}
              units={units}
              manufacturers={manufacturers}
              editing={classificationEditing}
              onEditToggle={setClassificationEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
          </>
        }
      />
    </Stack>
  );
}
