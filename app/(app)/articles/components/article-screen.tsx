"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { SidebarSection, WebDetailLayout, WebPage } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  PageHeader,
  scrollMainToTop,
  useEditMode,
  webTabIds,
  type PageHeaderBadge,
  type PageHeaderTab,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { setLastUsedView } from "@/lib/preferences/actions";
import type { ArticleComponentLineRecord, ArticleRecord } from "../actions";
import type { ArticleComponentTreeNode } from "../component-tree";
import type { ArticleParentRecord } from "../components-actions";
import { findArticleGroup, type FlattenedArticleGroup } from "../group-tree";
import { ARTICLE_DETAIL_VIEW_KEY } from "./constants";
import { draftFromArticle, emptyDraft, type ArticleDraft } from "./article-draft";
import { buildArticleSchema, createArticleFromDraft, saveArticleEdits } from "./article-form-schema";
import { ArticleOverviewCards, type ArticleReferenceLists } from "./article-overview-cards";
import { ArticleRail } from "./article-rail";
import { ArticleBomPanel, bomComponentCount } from "./article-bom-panel";
import { buildArticleTimeline } from "./article-timeline";
import { DeleteArticleDialog } from "./delete-article-dialog";

export type ArticleDetailTab = "overview" | "bom";

export interface ArticleScreenProps {
  mode: "create" | "edit";

  /** Required for `mode: "edit"`. */
  article?: ArticleRecord;
  /** `getArticle`'s own BOM lines (the timeline's "component added" events). */
  components?: ArticleComponentLineRecord[];
  /** The full downward bill-of-materials tree, rooted at this article —
   * fetched for a composite article only. */
  componentTree?: ArticleComponentTreeNode;
  /** The composite articles this article is a component of. */
  parents?: ArticleParentRecord[];
  /** The org's flattened Article Group tree and the `article_unit`/
   * `article_manufacturer`/`vat_rate` reference lists. */
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
  /** `can(actor, "articles", ...)`. Never render an affordance RLS would reject. */
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  cancelHref?: string;
  defaultTab?: ArticleDetailTab;
}

/**
 * The single shared screen behind `/articles/new` (`mode: "create"`) and
 * `/articles/[id]` (`mode: "edit"`) on the web design system (issue #222),
 * built exactly like the Asset and Quote pages:
 *
 *  - `PageHeader`: breadcrumb (`Articles / number`), title (the article's
 *    description, falling back to the number), badges (status → composite → group), ONE Edit button (Overview
 *    only, omitted without update permission), the ··· menu (Delete) and tabs.
 *    No navy primary and no LivePanel: the page holds no stock level, deadline
 *    or running timer, so there is nothing to act on right now;
 *  - centre: the active tab — Overview (ONE two-column Details card) or, for a
 *    composite article, Bill of materials (a StructureTree);
 *  - rail: Photo · Pricing · Structure (only when composite / part of one) ·
 *    TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateArticle` /
 * `createArticle` actions (RBAC and RLS untouched). `mode: "create"` is the
 * same page in new mode: Overview only, "After creating" rail, gold "Create
 * article".
 */
export function ArticleScreen({
  mode,
  article,
  components = [],
  componentTree,
  parents = [],
  groups,
  units,
  manufacturers,
  vatRates,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
  cancelHref,
  defaultTab = "overview",
}: ArticleScreenProps) {
  const router = useRouter();
  const isCreate = mode === "create";
  const [tab, setTab] = useState<ArticleDetailTab>(defaultTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();

  const lists = useMemo<ArticleReferenceLists>(
    () => ({ groups, units, manufacturers, vatRates }),
    [groups, units, manufacturers, vatRates],
  );

  // ---- Edit mode ------------------------------------------------------------
  const record = useMemo<ArticleDraft>(
    () => (article ? draftFromArticle(article, groups) : emptyDraft({ units, vatRates })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [article],
  );

  const schema = useMemo(
    () =>
      buildArticleSchema({
        labelFor: (key, id) => {
          switch (key) {
            case "groupId":
            case "subgroupId":
              return findArticleGroup(groups, id)?.name ?? "";
            case "manufacturerItemId":
              return manufacturers.find((item) => item.id === id)?.label ?? "";
            case "unitItemId":
              return units.find((item) => item.id === id)?.label ?? "";
            case "vatRateItemId":
              return vatRates.find((item) => item.id === id)?.label ?? "";
          }
        },
      }),
    [groups, manufacturers, units, vatRates],
  );

  const createdIdRef = useRef<string | null>(null);
  const edit = useEditMode<ArticleDraft>({
    record,
    schema,
    initialMode: isCreate ? "new" : "read",
    canEdit: !isCreate && canUpdate,
    idPrefix: "article",
    firstFieldKey: "articleNumber",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push(cancelHref ?? "/articles"),
    onSave: async (draft, dirty) => {
      if (isCreate) {
        if (createdIdRef.current) {
          router.push(`/articles/${createdIdRef.current}`);
          return { ok: true };
        }
        const { result, articleId } = await createArticleFromDraft(draft);
        if (!result.ok || !articleId) return result;
        createdIdRef.current = articleId;
        toast({ title: "Article created", tone: "success", duration: 3000 });
        router.push(`/articles/${articleId}`);
        return { ok: true };
      }
      return saveArticleEdits(article!.id, draft, dirty);
    },
    onSaved: () => {
      if (isCreate) return;
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // ---- Derived data ---------------------------------------------------------
  const saved = edit.record;
  const savedLeafGroup = findArticleGroup(groups, saved.subgroupId || saved.groupId);
  const showBomTab = !isCreate && Boolean(article?.is_composite);
  const componentCount = useMemo(() => bomComponentCount(componentTree), [componentTree]);
  const timeline = useMemo(() => (article ? buildArticleTimeline({ article, components }) : []), [article, components]);

  // ---- Tabs -----------------------------------------------------------------
  function selectTab(next: ArticleDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(ARTICLE_DETAIL_VIEW_KEY, next);
    });
  }

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      ...(showBomTab ? [{ id: "bom", label: "Bill of materials", count: componentCount }] : []),
    ],
    [showBomTab, componentCount],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // ---- Header ---------------------------------------------------------------
  const title = isCreate
    ? "New article"
    : saved.description || saved.articleNumber || article?.article_number || "Article";

  const badges: PageHeaderBadge[] = [];
  if (article) {
    badges.push({ label: saved.isActive ? "Active" : "Inactive", variant: saved.isActive ? "success" : "neutral" });
    if (saved.isComposite) badges.push({ label: "Composite" });
    const groupText = savedLeafGroup?.path ?? article.article_group?.name;
    if (groupText) badges.push({ label: groupText });
  }

  const overflow: WebMenuItem[] = [];
  if (canDelete && article) {
    overflow.push({ key: "delete", label: "Delete article", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  const breadcrumb = isCreate
    ? [{ label: "Articles", href: "/articles" }, { label: "New article" }]
    : [{ label: "Articles", href: "/articles" }, { label: article?.article_number ?? "Article", mono: true }];

  const header = (
    <PageHeader
      breadcrumb={breadcrumb}
      title={title}
      badges={badges}
      mode={edit.mode}
      actions={{
        canEdit: !isCreate && canUpdate && tab === "overview",
        onEdit: edit.startEdit,
        overflow,
        onSave: () => void edit.save(),
        onCancel: edit.requestCancel,
        saving: edit.saving,
        saveLabel: isCreate ? "Create article" : "Save",
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as ArticleDetailTab)}
      tabsLabel="Article sections"
      editStatus={edit.status}
    />
  );

  // ---- Rail -----------------------------------------------------------------
  const savedVat = vatRates.find((item) => item.id === saved.vatRateItemId);
  const vatNumber = savedVat ? Number(savedVat.value) : article?.vat_rate ? Number(article.vat_rate.value) : NaN;
  const priceOrNull = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const rail =
    isCreate || !article ? (
      <SidebarSection title="After creating">
        <p className="web-rail-empty">
          The article opens on its own page. For a composite article, build its bill of materials from the tab there.
        </p>
      </SidebarSection>
    ) : (
      <ArticleRail
        articleNumber={saved.articleNumber}
        imageUrl={saved.imageUrl.trim()}
        pricing={{
          purchase: priceOrNull(saved.purchasePrice),
          sale: priceOrNull(saved.salePrice),
          vatPercent: Number.isFinite(vatNumber) ? vatNumber : null,
        }}
        parents={parents}
        componentCount={componentCount}
        isComposite={article.is_composite}
        onShowBom={showBomTab ? () => selectTab("bom") : undefined}
      />
    );

  const ids = webTabIds(tab);

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={rail}
        timeline={{
          items: timeline,
          emptyText: isCreate ? "The timeline starts once this record is created." : "No activity yet",
        }}
        locked={editing && !isCreate}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        {tab === "overview" && (
          <div className="web-tab-stack">
            <ArticleOverviewCards edit={edit} article={article} lists={lists} isNew={isCreate} />
          </div>
        )}

        {tab === "bom" && article && showBomTab && (
          <ArticleBomPanel
            articleId={article.id}
            tree={componentTree}
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canDelete}
            onChange={() => router.refresh()}
          />
        )}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />

      {!isCreate && article && deleteOpen && (
        <DeleteArticleDialog article={article} open onOpenChange={setDeleteOpen} redirectOnDelete />
      )}
    </WebPage>
  );
}
