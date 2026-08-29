import type { ArticleGroupRecord } from "./groups-actions";

/**
 * Shared Article Group tree helpers (issue #92). `listArticleGroups()`
 * returns the org's whole tree as flat rows (each with its own
 * `parent_group_id`, unlimited depth) — every UI that needs the tree shape
 * builds it client-side from those same flat rows via one of these two
 * helpers, rather than re-implementing tree-walking per call site:
 *
 *  - `flattenArticleGroups`: a depth-first ordered list (parents before their
 *    own children) with a `depth` (for an indented `<Select>`, see the
 *    Article form's Group picker) and a `path` breadcrumb string (for the
 *    Articles list's flat "Group > Subgroup" filter `<Select>`).
 *  - `buildArticleGroupTree`: the actual nested tree shape, for the Article
 *    Groups settings manager's own recursive `Disclosure` rendering.
 *
 * Plain functions, no "use client"/"use server" — safe to import from both a
 * Server Component (`articles-screen.tsx`, `reference-lists-board.tsx`) and a
 * Client Component (`article-form-panel.tsx`, `article-group-manager.tsx`).
 */

function groupChildrenByParent(groups: ArticleGroupRecord[]): Map<string | null, ArticleGroupRecord[]> {
  const byParent = new Map<string | null, ArticleGroupRecord[]>();
  for (const group of groups) {
    const key = group.parent_group_id;
    const list = byParent.get(key);
    if (list) list.push(group);
    else byParent.set(key, [group]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }
  return byParent;
}

export interface FlattenedArticleGroup {
  id: string;
  name: string;
  depth: number;
  /** e.g. "Parts > Filters > Air filters" — every ancestor's name, joined. */
  path: string;
}

export function flattenArticleGroups(groups: ArticleGroupRecord[]): FlattenedArticleGroup[] {
  const byParent = groupChildrenByParent(groups);
  const result: FlattenedArticleGroup[] = [];

  function visit(parentId: string | null, depth: number, parentPath: string) {
    for (const group of byParent.get(parentId) ?? []) {
      const path = parentPath ? `${parentPath} > ${group.name}` : group.name;
      result.push({ id: group.id, name: group.name, depth, path });
      visit(group.id, depth + 1, path);
    }
  }

  visit(null, 0, "");
  return result;
}

export interface ArticleGroupTreeNode {
  group: ArticleGroupRecord;
  children: ArticleGroupTreeNode[];
}

export function buildArticleGroupTree(groups: ArticleGroupRecord[]): ArticleGroupTreeNode[] {
  const byParent = groupChildrenByParent(groups);

  function build(parentId: string | null): ArticleGroupTreeNode[] {
    return (byParent.get(parentId) ?? []).map((group) => ({ group, children: build(group.id) }));
  }

  return build(null);
}
