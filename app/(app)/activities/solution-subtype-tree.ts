import type { SolutionSubtypeRecord } from "./solution-subtype-actions";

/**
 * Shared Solution Subtype tree helpers (issues #134/#138). Mirrors
 * `app/(app)/activities/subtype-tree.ts` / `app/(app)/articles/group-tree.ts`
 * exactly, parameterized for `SolutionSubtypeRecord` — no type-related
 * helpers here, since `solution_subtypes` is never linked to Type at any
 * level (contrast with its sibling `subtype-tree.ts`'s `typeId`/root-type
 * concerns).
 *
 * Plain functions, no "use client"/"use server" — safe to import from both a
 * Server Component and a Client Component.
 */

function subtypesByParent(subtypes: SolutionSubtypeRecord[]): Map<string | null, SolutionSubtypeRecord[]> {
  const byParent = new Map<string | null, SolutionSubtypeRecord[]>();
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

export interface FlattenedSolutionSubtype {
  id: string;
  name: string;
  depth: number;
  /** e.g. "Reparatie > Onderdeel vervangen" — every ancestor's name,
   * joined. */
  path: string;
  /** This subtype's own `parent_subtype_id`, carried through unchanged —
   * `null` for a depth-0 (root) subtype. */
  parentId: string | null;
}

export function flattenSolutionSubtypes(subtypes: SolutionSubtypeRecord[]): FlattenedSolutionSubtype[] {
  const byParent = subtypesByParent(subtypes);
  const result: FlattenedSolutionSubtype[] = [];

  function visit(parentId: string | null, depth: number, parentPath: string) {
    for (const subtype of byParent.get(parentId) ?? []) {
      const path = parentPath ? `${parentPath} > ${subtype.name}` : subtype.name;
      result.push({ id: subtype.id, name: subtype.name, depth, path, parentId });
      visit(subtype.id, depth + 1, path);
    }
  }

  visit(null, 0, "");
  return result;
}

export interface SolutionSubtypeTreeNode {
  subtype: SolutionSubtypeRecord;
  children: SolutionSubtypeTreeNode[];
}

export function buildSolutionSubtypeTree(subtypes: SolutionSubtypeRecord[]): SolutionSubtypeTreeNode[] {
  const byParent = subtypesByParent(subtypes);

  function build(parentId: string | null): SolutionSubtypeTreeNode[] {
    return (byParent.get(parentId) ?? []).map((subtype) => ({ subtype, children: build(subtype.id) }));
  }

  return build(null);
}

/** This subtype's own record from `subtypes`, or `undefined` if `id` is
 * unset/no longer exists. */
export function findSolutionSubtype(
  subtypes: FlattenedSolutionSubtype[],
  id: string | null | undefined,
): FlattenedSolutionSubtype | undefined {
  return id ? subtypes.find((subtype) => subtype.id === id) : undefined;
}

/** Walks a subtype's `parentId` chain up to its depth-0 (root) ancestor —
 * `""` if `id` doesn't resolve to a real subtype. Depth-0 subtypes are their
 * own top ancestor. */
export function topSolutionSubtypeAncestorId(
  subtypes: FlattenedSolutionSubtype[],
  id: string | null | undefined,
): string {
  let current = findSolutionSubtype(subtypes, id);
  while (current && current.depth > 0 && current.parentId) {
    current = findSolutionSubtype(subtypes, current.parentId);
  }
  return current?.id ?? "";
}

/** Whether `subtype` sits anywhere underneath `ancestorId` (any depth, not
 * just a direct child). */
export function isSolutionSubtypeDescendantOf(
  subtypes: FlattenedSolutionSubtype[],
  subtype: FlattenedSolutionSubtype,
  ancestorId: string,
): boolean {
  let current: FlattenedSolutionSubtype | undefined = subtype;
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = findSolutionSubtype(subtypes, current.parentId);
  }
  return false;
}
