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
 * composite).
 *
 * Owns one flat `ArticleDraft` (`./article-draft.ts`) as the source of truth
 * for every editable field; every section reads from it and writes back
 * through `commitPatch` below (`mode: "create"` only — a local-only merge
 * until the hero's own "Create article" action fires `createArticle` with
 * the whole accumulated draft and navigates to the new record) or through
 * `updateDraft` (`mode: "edit"` — a local-only merge too, per keystroke; see
 * below).
 *
 * `mode: "edit"` has exactly ONE editing surface, not five independent ones:
 * the hero's own pencil (`ArticleHero`'s `onEditHeader`, next to the title/
 * badges) opens every section (Info/Pricing/Status/Media/Classification) into
 * its inline-edit state at once, driven by the single `pageEditing` boolean
 * below (each section's own per-section pencil is gone as a natural
 * consequence — see each section's own `onEdit` computation) — every field
 * writes straight into the shared `draft` on every change (`updateDraft`,
 * passed down as each section's own `onFieldChange`), and the ONE Save/Cancel
 * pair rendered in the hero's `actions` slot (replacing `ArticleDetailActions`
 * while `pageEditing`) commits the whole `draft` in a single `commitPatch`
 * call, or discards it and re-derives `draft` from the server record.
 * Required-field validation (Article number/Description) that used to live
 * inside `ArticleInfoSection`'s own `handleSave` now lives in this screen's
 * own `handleEditSave`, surfaced the same way `handleCreate` already
 * surfaces its own.
 *
 * `mode: "create"` is untouched by any of the above — every section still
 * owns its own local echo state, Save button, and (for every section except
 * "Article", whose Info/Description fields are the two hard-required fields
 * and stay forced open for the whole flow, same "always open, no Cancel"
 * treatment `AssetEquipmentSection` gives its own required Type field) its
 * own independent open/close toggle, same as before this change.
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
  // `pageEditing` is the ONLY editing surface for `mode: "edit"` — the other
  // five booleans below are `mode: "create"`-only (untouched by this
  // change).
  const [pageEditing, setPageEditing] = useState(false);
  const [infoEditing, setInfoEditing] = useState(true);
  const [mediaEditing, setMediaEditing] = useState(false);
  const [classificationEditing, setClassificationEditing] = useState(mode === "create");
  const [pricingEditing, setPricingEditing] = useState(mode === "create");
  const [statusEditing, setStatusEditing] = useState(mode === "create");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  /** `mode: "create"`'s own sections' Save call this — unchanged. `mode:
   * "edit"`'s single page-level Save (`handleEditSave` below) also calls
   * this, once, with the whole `draft`. */
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

  /** `mode: "edit"`'s own sections' every field change calls this directly —
   * a local-only merge, same shape `commitPatch`'s own `mode: "create"`
   * branch already has, just never posted to the server until the page's own
   * Save (`handleEditSave` below). */
  function updateDraft(patch: Partial<ArticleDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleEditCancel() {
    if (article) setDraft(draftFromArticle(article));
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
      setEditError(result.error ?? "Could not save.");
      return;
    }
    setPageEditing(false);
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
      pageEditing ? (
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
      )
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
      {editError && <Text tone="danger">{editError}</Text>}

      <ArticleHero
        mode={mode}
        draft={draft}
        article={article}
        groups={groups}
        actions={heroActions}
        readOnly={readOnly}
        onEditHeader={mode === "edit" && !readOnly && !pageEditing ? () => setPageEditing(true) : undefined}
      />

      <DetailColumns
        left={
          <>
            <ArticleInfoSection
              mode={mode}
              draft={draft}
              article={article}
              editing={mode === "edit" ? pageEditing : infoEditing}
              onEditToggle={mode === "edit" ? undefined : setInfoEditing}
              readOnly={readOnly}
              onSave={commitPatch}
              onFieldChange={mode === "edit" ? updateDraft : undefined}
            />

            <ArticlePricingSection
              mode={mode}
              draft={draft}
              article={article}
              vatRates={vatRates}
              editing={mode === "edit" ? pageEditing : pricingEditing}
              onEditToggle={mode === "edit" ? undefined : setPricingEditing}
              readOnly={readOnly}
              onSave={commitPatch}
              onFieldChange={mode === "edit" ? updateDraft : undefined}
            />

            <ArticleStatusSection
              mode={mode}
              draft={draft}
              article={article}
              components={components}
              componentTree={componentTree}
              editing={mode === "edit" ? pageEditing : statusEditing}
              onEditToggle={mode === "edit" ? undefined : setStatusEditing}
              readOnly={readOnly}
              onSave={commitPatch}
              onFieldChange={mode === "edit" ? updateDraft : undefined}
            />
          </>
        }
        right={
          <>
            <ArticleMediaSection
              mode={mode}
              draft={draft}
              articleNumber={draft.articleNumber || undefined}
              editing={mode === "edit" ? pageEditing : mediaEditing}
              onEditToggle={mode === "edit" ? undefined : setMediaEditing}
              readOnly={readOnly}
              onSave={commitPatch}
              onFieldChange={mode === "edit" ? updateDraft : undefined}
            />

            <ArticleClassificationSection
              mode={mode}
              draft={draft}
              article={article}
              groups={groups}
              units={units}
              manufacturers={manufacturers}
              editing={mode === "edit" ? pageEditing : classificationEditing}
              onEditToggle={mode === "edit" ? undefined : setClassificationEditing}
              readOnly={readOnly}
              onSave={commitPatch}
              onFieldChange={mode === "edit" ? updateDraft : undefined}
            />
          </>
        }
      />
    </Stack>
  );
}
