"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs, Button, DetailColumns, Stack, Text, type BreadcrumbItem } from "@yourorg/ui";
import { updateArticle, type ArticleComponentLineRecord, type ArticleRecord } from "../actions";
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
import { draftFromArticle, draftToInput, type ArticleDraft } from "./article-draft";

export interface ArticleScreenProps {
  /** Built by the server `page.tsx` and pushed into the Topbar via
   * `usePageHeader` — never rendered inline in the page body, matching
   * `client-detail.tsx`/`WorkOrderScreen`/`ActivityScreen`'s own pattern. */
  breadcrumbItems: BreadcrumbItem[];

  article: ArticleRecord;
  /** `getArticle`'s own BOM lines. */
  components?: ArticleComponentLineRecord[];
  /** `getArticleComponentTree`'s full recursive descendant tree, rooted at
   * this article — `article.is_composite === true` only (see
   * `loadArticleScreenProps`'s own gate); `undefined` otherwise. Fetched
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

  canDelete?: boolean;

  /** Seeds `pageEditing` (below) to `true` on mount instead of `false` — set
   * by `/articles/[id]/edit`'s own `page.tsx` only, never
   * `/articles/[id]`'s. `CreateArticleButton` (`./create-article-button.tsx`)
   * creates a bare placeholder article and navigates straight to
   * `/articles/[id]/edit` so the caller lands with every section already in
   * its inline-edit state — as if the hero's own pencil were already
   * clicked — ready to overwrite every placeholder field and hit the one
   * Save button, rather than requiring an extra click first. Ignored (forced
   * to `false`) for a `readOnly` viewer — see this component's own state
   * initializer below.
   */
  startInEditMode?: boolean;
}

/**
 * The single shared screen behind `/articles/[id]` and `/articles/[id]/edit`
 * (identical props except `startInEditMode`, see both those routes' own
 * `page.tsx`) — one real screen, not two, replacing the old `ArticleFormPanel`
 * slide-in (issue #123, "Article popup" — see `docs/ARCHITECTURE.md`'s "Popup
 * vs. full page" section for the history). There is no `/articles/new` create
 * form and no `mode` prop: `CreateArticleButton` creates a bare placeholder
 * article immediately and navigates straight here, exactly the way
 * `ContractScreen`/`CreateContractButton` already do for Contracts (see `git
 * show a4bbd4c`) — the only difference from that precedent is that Articles
 * lands with editing already active (`startInEditMode`) instead of every
 * section closed, per the product owner's explicit ask. Mirrors `AssetScreen`'s
 * per-section `EditableSection` shape rather than `ActivityScreen`'s "relation
 * cards + dialogs" one: an Article has no client/site/model relation of its
 * own to surface as a `RelationCard`, so there's nothing here that needs a
 * small edit-popup — every field is a plain value grouped into one of five
 * flat sections (Article / Photo / Classification / Pricing & VAT / Status &
 * composite).
 *
 * Owns one flat `ArticleDraft` (`./article-draft.ts`) as the source of truth
 * for every editable field, seeded from the server `article` record. There is
 * exactly ONE editing surface for the whole screen, not five independent
 * ones: the hero's own pencil (`ArticleHero`'s `onEditHeader`, next to the
 * title/badges) opens every section (Info/Pricing/Status/Media/
 * Classification) into its inline-edit state at once, driven by the single
 * `pageEditing` boolean below (each section's own per-section pencil is gone
 * as a natural consequence — see each section's own `onEdit` computation,
 * now always omitted) — every field writes straight into the shared `draft`
 * on every change (`updateDraft`, passed down as each section's own
 * `onFieldChange`), and the ONE Save/Cancel pair rendered in the hero's
 * `actions` slot (replacing `ArticleDetailActions` while `pageEditing`)
 * commits the whole `draft` in a single `commitPatch` call, or discards it
 * and re-derives `draft` from the server record. Required-field validation
 * (Article number/Description) lives in this screen's own `handleEditSave`.
 */
export function ArticleScreen({
  breadcrumbItems,
  article,
  components,
  componentTree,
  readOnly,
  groups,
  units,
  manufacturers,
  vatRates,
  canDelete,
  startInEditMode,
}: ArticleScreenProps) {
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<ArticleDraft>(() => draftFromArticle(article));

  // The ONE editing surface for this whole screen (see this component's own
  // doc comment) — seeded `true` by `startInEditMode` (the `/edit` route) so
  // a just-created article lands ready to fill in immediately; forced `false`
  // regardless of `startInEditMode` for a `readOnly` viewer, same "never
  // render an edit affordance RLS would reject" convention this screen's own
  // `readOnly` prop documents elsewhere.
  const [pageEditing, setPageEditing] = useState(() => Boolean(startInEditMode) && !readOnly);

  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  /** The page's single Save (`handleEditSave` below) calls this once with the
   * whole accumulated `draft`. Surfaces `fieldErrors` alongside the generic
   * `error` — the server's own validation message (e.g. "Purchase price must
   * be zero or more.") is what actually tells the caller which field is
   * wrong; the previous per-section Save flow never needed this because each
   * section only ever sent its OWN few fields, so a stray bad value
   * elsewhere in the draft could never block an unrelated section's save the
   * way it now can with one page-wide Save. */
  async function commitPatch(
    patch: Partial<ArticleDraft>,
  ): Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[] | undefined> }> {
    const result = await updateArticle(article.id, draftToInput(patch));
    if (!result.data) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
    setDraft((prev) => ({ ...prev, ...patch }));
    router.refresh();
    return { ok: true };
  }

  /** Every section's own field change calls this directly — a local-only
   * merge into the shared `draft`, never posted to the server until the
   * page's own Save (`handleEditSave` below). */
  function updateDraft(patch: Partial<ArticleDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleEditCancel() {
    setDraft(draftFromArticle(article));
    setEditError(null);
    setPageEditing(false);
  }

  async function handleEditSave() {
    if (!draft.articleNumber.trim()) {
      setEditError("Article number is required.");
      return;
    }
    if (!draft.description.trim()) {
      setEditError("Description is required.");
      return;
    }
    setEditError(null);
    setSaving(true);
    const result = await commitPatch(draft);
    setSaving(false);
    if (!result.ok) {
      const fieldMessages = Object.values(result.fieldErrors ?? {})
        .flatMap((messages) => messages ?? [])
        .filter(Boolean);
      setEditError(
        fieldMessages.length > 0
          ? fieldMessages.join(" ")
          : result.error ?? "Could not save.",
      );
      return;
    }
    setPageEditing(false);
  }

  const heroActions = pageEditing ? (
    <>
      <Button type="button" variant="outline" onClick={handleEditCancel} disabled={saving}>
        Cancel
      </Button>
      <Button type="button" variant="primary" onClick={handleEditSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </>
  ) : (
    <ArticleDetailActions article={article} canDelete={Boolean(canDelete)} />
  );

  return (
    <Stack gap="lg">
      {editError && <Text tone="danger">{editError}</Text>}

      <ArticleHero
        draft={draft}
        article={article}
        groups={groups}
        actions={heroActions}
        readOnly={readOnly}
        onEditHeader={!readOnly && !pageEditing ? () => setPageEditing(true) : undefined}
      />

      <DetailColumns
        left={
          <>
            <ArticleInfoSection draft={draft} article={article} editing={pageEditing} onFieldChange={updateDraft} />

            <ArticlePricingSection
              draft={draft}
              article={article}
              vatRates={vatRates}
              editing={pageEditing}
              onFieldChange={updateDraft}
            />

            <ArticleStatusSection
              draft={draft}
              article={article}
              components={components}
              componentTree={componentTree}
              editing={pageEditing}
              readOnly={readOnly}
              onFieldChange={updateDraft}
            />
          </>
        }
        right={
          <>
            <ArticleMediaSection
              draft={draft}
              articleNumber={draft.articleNumber || undefined}
              editing={pageEditing}
              onFieldChange={updateDraft}
            />

            <ArticleClassificationSection
              draft={draft}
              article={article}
              groups={groups}
              units={units}
              manufacturers={manufacturers}
              editing={pageEditing}
              onFieldChange={updateDraft}
            />
          </>
        }
      />
    </Stack>
  );
}
