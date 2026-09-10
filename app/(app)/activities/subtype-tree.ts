import type { ActivitySubtypeRecord } from "./subtypes-actions";

/**
 * Shared Activity Subtype tree helpers (issues #134/#138). Mirrors
 * `app/(app)/articles/group-tree.ts` exactly, parameterized for
 * `ActivitySubtypeRecord` — see that file's own top comment for the full
 * rationale (`listActivitySubtypes()` returns the org's whole tree as flat
 * rows; every UI that needs the tree shape builds it client-side from those
 * same flat rows via one of these helpers rather than re-implementing
 * tree-walking per call site).
 *
 * Two call sites this file is built for: the Settings tree manager
 * (`buildActivitySubtypeTree`, recursive `Disclosure` rendering) and the
 * Activity page's 3-level cascading picker (`flattenActivitySubtypes` +
 * `topActivitySubtypeAncestorId`/`isActivitySubtypeDescendantOf` for the
 * Type-scoped cascade — the frontend separately resolves that root's own
 * `type_id` from the same flat `ActivitySubtypeRecord[]` it already fetched,
 * to determine which Activity Type a branch belongs to).
 *
 * Plain functions, no "use client"/"use server" — safe to import from both a
 * Server Component and a Client Component.
 */

function subtypesByParent(subtypes: ActivitySubtypeRecord[]): Map<string | null, ActivitySubtypeRecord[]> {
  const byParent = new Map<string | null, ActivitySubtypeRecord[]>();
  for (const subtype of subtypes) {
    const key = subtype.parent_subtype_id;
    const list = byParent.get(key);
    if (list) list.push(subtype);
    else byParent.set(key, [subtype]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }
  return byParent;
}

export interface FlattenedActivitySubtype {
  id: string;
  name: string;
  depth: number;
  /** e.g. "Storing > Elektrisch > Kortsluiting" — every ancestor's name,
   * joined. */
  path: string;
  /** This subtype's own `parent_subtype_id`, carried through unchanged —
   * `null` for a depth-0 (root) subtype. */
  parentId: string | null;
  /** This subtype's own `type_id`, carried through unchanged — non-null only
   * for a depth-0 (root) subtype (`activity_subtypes_root_xor_parent`); `null`
   * for every deeper node. Callers needing "which Activity Type does this
   * deep node's branch belong to" should resolve the root via
   * `topActivitySubtypeAncestorId` first, then read THAT node's `typeId`. */
  typeId: string | null;
}

export function flattenActivitySubtypes(subtypes: ActivitySubtypeRecord[]): FlattenedActivitySubtype[] {
  const byParent = subtypesByParent(subtypes);
  const result: FlattenedActivitySubtype[] = [];

  function visit(parentId: string | null, depth: number, parentPath: string) {
    for (const subtype of byParent.get(parentId) ?? []) {
      const path = parentPath ? `${parentPath} > ${subtype.name}` : subtype.name;
      result.push({
        id: subtype.id,
        name: subtype.name,
        depth,
        path,
        parentId,
        typeId: subtype.type_id,
      });
      visit(subtype.id, depth + 1, path);
    }
  }

  visit(null, 0, "");
  return result;
}

export interface ActivitySubtypeTreeNode {
  subtype: ActivitySubtypeRecord;
  children: ActivitySubtypeTreeNode[];
}

export function buildActivitySubtypeTree(subtypes: ActivitySubtypeRecord[]): ActivitySubtypeTreeNode[] {
  const byParent = subtypesByParent(subtypes);

  function build(parentId: string | null): ActivitySubtypeTreeNode[] {
    return (byParent.get(parentId) ?? []).map((subtype) => ({ subtype, children: build(subtype.id) }));
  }

  return build(null);
}

/** This subtype's own record from `subtypes`, or `undefined` if `id` is
 * unset/no longer exists. */
export function findActivitySubtype(
  subtypes: FlattenedActivitySubtype[],
  id: string | null | undefined,
): FlattenedActivitySubtype | undefined {
  return id ? subtypes.find((subtype) => subtype.id === id) : undefined;
}

/** Walks a subtype's `parentId` chain up to its depth-0 (root) ancestor —
 * `""` if `id` doesn't resolve to a real subtype. Depth-0 subtypes are their
 * own top ancestor. The frontend looks up that root's own `typeId` separately
 * (from the same flat list) to answer "which Activity Type does this branch
 * belong to". */
export function topActivitySubtypeAncestorId(
  subtypes: FlattenedActivitySubtype[],
  id: string | null | undefined,
): string {
  let current = findActivitySubtype(subtypes, id);
  while (current && current.depth > 0 && current.parentId) {
    current = findActivitySubtype(subtypes, current.parentId);
  }
  return current?.id ?? "";
}

/** Whether `subtype` sits anywhere underneath `ancestorId` (any depth, not
 * just a direct child). */
export function isActivitySubtypeDescendantOf(
  subtypes: FlattenedActivitySubtype[],
  subtype: FlattenedActivitySubtype,
  ancestorId: string,
): boolean {
  let current: FlattenedActivitySubtype | undefined = subtype;
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = findActivitySubtype(subtypes, current.parentId);
  }
  return false;
}
