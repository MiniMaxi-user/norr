import type { ResolvedReferenceItem } from "./actions";

/**
 * Shared Article Component (bill-of-materials) tree-assembly helpers (issue
 * #124, nested composites). `getArticleComponentTree` in
 * `./components-actions.ts` fetches the org's whole `article_components`
 * table as flat rows once, then hands them to `buildArticleComponentTree`
 * here to assemble the actual recursive tree — same "flat fetch, build the
 * tree in plain TS" split `./group-tree.ts` establishes for
 * `article_groups`' `flattenArticleGroups`/`buildArticleGroupTree`.
 *
 * Unlike `article_groups` (a single global tree with `parent_group_id`, so
 * "the tree" has one well-defined set of top-level roots), a composite
 * article's bill-of-materials has no single well-defined root: any article
 * can be a component of many different composites simultaneously, and this
 * helper only ever assembles ONE article's downward descendant tree at a
 * time (rooted at whatever `articleId` the caller asked for) — there's no
 * "list every root" entry point the way `buildArticleGroupTree(groups)`'s
 * `build(null)` has.
 *
 * Plain functions, no `"use server"` — safe to import from a Server
 * Component or a future Client Component the same way `./group-tree.ts` is.
 */

/** Basic display fields for one article inside the tree — the root node's
 * own article, and every descendant node's `component_article` embed, share
 * this exact shape so the frontend can render any node uniformly. Mirrors
 * `ArticleComponentLineRecord.component_article` in `./actions.ts`, plus
 * `is_composite` (needed here — unlike the one-level BOM editor — so the UI
 * can tell whether a leaf-looking node is a composite with zero components
 * of its own vs. a genuinely non-composite article). */
export interface ArticleComponentTreeArticle {
  id: string;
  article_number: string;
  description: string;
  image_url: string | null;
  is_active: boolean;
  is_composite: boolean;
  unit_item_id: string;
  article_unit: ResolvedReferenceItem | null;
}

/** One flat `article_components` row, as fetched (org-wide, unfiltered) by
 * `getArticleComponentTree` — `parent_article_id` is kept (needed to group
 * rows by parent while assembling the tree) even though the assembled
 * `ArticleComponentTreeNode` shape below doesn't repeat it. */
export interface FlatArticleComponentRow {
  id: string;
  parent_article_id: string;
  component_article_id: string;
  quantity: number;
  component_article: ArticleComponentTreeArticle;
}

export interface ArticleComponentTreeNode {
  article: ArticleComponentTreeArticle;
  /** This node's own BOM-line quantity (how much of `article` one unit of
   * its parent consumes) — `1` for the tree's root node, which isn't itself
   * a component of anything within this tree (there's no real quantity to
   * report for "how much of itself the root article consumes"). */
  quantity: number;
  /** This node's own `article_components.id`, or `null` for the root node
   * (the root is `articleId` itself, not a BOM line). */
  componentId: string | null;
  children: ArticleComponentTreeNode[];
}

/** Same defensive depth cap `validate_article_component`'s own cycle-
 * detection CTE uses (see
 * `supabase/migrations/20260906090000_article_components_allow_nested_composites.sql`)
 * — a cycle should never exist post-migration (the DB trigger rejects one at
 * write time), but this keeps a bug here from turning into unbounded
 * recursion rather than trusting the DB alone. */
const MAX_TREE_DEPTH = 1000;

/**
 * Assembles `rootArticle`'s full downward descendant tree from `rows` (every
 * `article_components` row belonging to the caller's org, unfiltered —
 * `getArticleComponentTree` fetches once, this walks `parent_article_id`
 * matches recursively from `rootArticle.id` down).
 *
 * Defensively cycle-safe on top of the DB's own guard: a running `ancestors`
 * set (the current root-to-node path) is checked before recursing into any
 * child, and recursion is depth-capped at `MAX_TREE_DEPTH` — either guard
 * tripping simply stops that branch early (an already-impossible case, per
 * the DB trigger) rather than throwing.
 */
export function buildArticleComponentTree(
  rootArticle: ArticleComponentTreeArticle,
  rows: FlatArticleComponentRow[],
): ArticleComponentTreeNode {
  const byParent = new Map<string, FlatArticleComponentRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent_article_id);
    if (list) list.push(row);
    else byParent.set(row.parent_article_id, [row]);
  }

  function buildChildren(articleId: string, ancestors: ReadonlySet<string>, depth: number): ArticleComponentTreeNode[] {
    if (depth >= MAX_TREE_DEPTH) return [];
    return (byParent.get(articleId) ?? [])
      .filter((row) => !ancestors.has(row.component_article_id))
      .map((row) => {
        const childAncestors = new Set(ancestors);
        childAncestors.add(row.component_article_id);
        return {
          article: row.component_article,
          quantity: row.quantity,
          componentId: row.id,
          children: buildChildren(row.component_article_id, childAncestors, depth + 1),
        };
      });
  }

  return {
    article: rootArticle,
    quantity: 1,
    componentId: null,
    children: buildChildren(rootArticle.id, new Set([rootArticle.id]), 0),
  };
}
