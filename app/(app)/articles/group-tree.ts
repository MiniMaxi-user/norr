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
 * Client Component (`article-classification-section.tsx`, `article-group-manager.tsx`).
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
  /** This group's own `parent_group_id`, carried through unchanged — `null`
   * for a depth-0 (top-level) group. Added for issue #98's Group/Subgroup
   * cascading picker (`article-classification-section.tsx`, moved there from
   * the deleted `article-form-panel.tsx` by issue #123), which needs to walk
   * a group's ancestor chain (e.g. to find a depth-2+ group's depth-0
   * ancestor) without re-fetching `ArticleGroupRecord[]` itself — every
   * existing caller (`articles-filters.tsx`, `articles-table.tsx`,
   * `article-group-form-dialog.tsx`) only ever reads the pre-existing
   * fields, so this addition is purely additive. */
  parentId: string | null;
}

export function flattenArticleGroups(groups: ArticleGroupRecord[]): FlattenedArticleGroup[] {
  const byParent = groupChildrenByParent(groups);
  const result: FlattenedArticleGroup[] = [];

  function visit(parentId: string | null, depth: number, parentPath: string) {
    for (const group of byParent.get(parentId) ?? []) {
      const path = parentPath ? `${parentPath} > ${group.name}` : group.name;
      result.push({ id: group.id, name: group.name, depth, path, parentId });
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

/** This group's own record from `groups`, or `undefined` if `id` is
 * unset/no longer exists (e.g. the group was deleted after an article was
 * assigned to it). Moved here from the old `article-form-panel.tsx` (issue
 * #123's page conversion) since it's a plain tree-walking helper other
 * Group/Subgroup cascade UIs want too, not form-specific. */
export function findArticleGroup(
  groups: FlattenedArticleGroup[],
  id: string | null | undefined,
): FlattenedArticleGroup | undefined {
  return id ? groups.find((group) => group.id === id) : undefined;
}

/** Walks a group's `parentId` chain up to its depth-0 (top-level) ancestor —
 * `""` if `id` doesn't resolve to a real group. Depth-0 groups are their own
 * top ancestor. */
export function topArticleGroupAncestorId(groups: FlattenedArticleGroup[], id: string | null | undefined): string {
  let current = findArticleGroup(groups, id);
  while (current && current.depth > 0 && current.parentId) {
    current = findArticleGroup(groups, current.parentId);
  }
  return current?.id ?? "";
}

/** Whether `group` sits anywhere underneath `ancestorId` (any depth, not just
 * a direct child) — used for the depth-2+ Subgroup fallback in the
 * Classification section's Group/Subgroup cascade. */
export function isArticleGroupDescendantOf(
  groups: FlattenedArticleGroup[],
  group: FlattenedArticleGroup,
  ancestorId: string,
): boolean {
  let current: FlattenedArticleGroup | undefined = group;
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = findArticleGroup(groups, current.parentId);
  }
  return false;
}
