"use client";

import type { ReactNode } from "react";
import { Badge, RecordHeroBand } from "@yourorg/ui";
import { Building2, Settings } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import type { FlattenedArticleGroup } from "../group-tree";
import { findArticleGroup } from "../group-tree";
import type { ArticleDraft } from "./article-draft";

export interface ArticleHeroProps {
  mode: "create" | "edit";
  draft: ArticleDraft;
  article?: ArticleRecord;
  groups: FlattenedArticleGroup[];
  actions?: ReactNode;
}

/**
 * The full-bleed dark hero band at the top of the Article detail/create
 * screen (issue #123, converting the old `ArticleFormPanel` slide-in into a
 * real page per `docs/ARCHITECTURE.md`'s "Popup vs. full page" section).
 * Unlike Work Orders/Assets/Activities, an Article has no client/site/model
 * relation of its own to surface as `RelationCard`s below the band — its
 * closest thing to a "related record" is Classification (Group/Subgroup), a
 * plain field, not a cross-module link, so it stays a section below rather
 * than a relation card here. No stats strip either (`noStats`) — an
 * article's own facts fit comfortably in the flat sections beneath it,
 * same "no stats" call `ActivityHero` made.
 *
 * `title` is `article.article_number` (an article's own identifying code,
 * closest analog to `AssetHero`'s `asset.name` — both are a plain, non-
 * editable-here `<h1>`; the actual field lives in the Article/Equipment
 * section instead), NOT the free-text `description` — that field can run to
 * 2000 characters and reads far better as a `meta` line/section content than
 * as a giant serif heading.
 */
export function ArticleHero({ mode, draft, article, groups, actions }: ArticleHeroProps) {
  const groupPath = findArticleGroup(groups, draft.groupId)?.path ?? article?.article_group?.name;

  const meta: ReactNode[] = [
    <span className="ui-record-hero-band-meta-badges" key="status">
      {mode === "edit" && article ? (
        <Badge variant={article.is_active ? "success" : "muted"}>{article.is_active ? "Active" : "Inactive"}</Badge>
      ) : (
        <Badge variant="accent">New</Badge>
      )}
      {(article?.is_composite ?? draft.isComposite) && <Badge variant="accent">Composite</Badge>}
    </span>,
  ];
  if (groupPath) {
    meta.push(
      <>
        <Settings /> {groupPath}
      </>,
    );
  }
  const manufacturerLabel = article?.article_manufacturer?.label;
  if (manufacturerLabel) {
    meta.push(
      <>
        <Building2 /> {manufacturerLabel}
      </>,
    );
  }

  return (
    <RecordHeroBand
      title={
        <h1 className="ui-record-hero-band-title">
          {mode === "create" ? "New article" : (article?.article_number ?? "—")}
        </h1>
      }
      meta={meta}
      actions={actions}
      noStats
    />
  );
}
