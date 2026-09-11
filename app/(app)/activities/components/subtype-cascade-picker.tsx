"use client";

import { useEffect, useMemo, useState } from "react";
import { Combobox, Stack } from "@yourorg/ui";

/**
 * The minimal shape both `ActivitySubtypeRecord` (`../subtypes-actions.ts`)
 * and `SolutionSubtypeRecord` (`../solution-subtype-actions.ts`) already
 * satisfy — this component is generic over either tree's flat row list, not
 * tied to one tree's own record type (issues #134/#138 both need the exact
 * same 3-level cascade UI, just over two different tables).
 */
export interface SubtypeCascadeNode {
  id: string;
  parent_subtype_id: string | null;
  name: string;
  sort_order: number;
}

export interface SubtypeCascadePickerProps<T extends SubtypeCascadeNode> {
  /** The org's WHOLE flat tree for this taxonomy (every depth) — this
   * component derives its own 3 levels' option lists from these, the same
   * "caller passes everything once, component derives the filtered view"
   * contract `article-classification-section.tsx`'s Group/Subgroup pair
   * already follows over `FlattenedArticleGroup[]`. */
  nodes: T[];
  /** The single committed LEAF value — the deepest node picked so far. May
   * legitimately be a depth-0 or depth-1 node (not a "true" leaf with no
   * children of its own) when the user hasn't picked any deeper — see this
   * component's own doc comment below. `""` = none picked. */
  value: string;
  onChange: (nextValue: string) => void;
  /** Restricts level-1 (root, `parent_subtype_id === null`) options — the
   * Activity-subtype caller uses this to only show roots whose `type_id`
   * matches the activity's currently-selected Activity Type. Omitted
   * entirely by the Solution-subtype caller, which shows every root (that
   * tree is never linked to Type at any level). */
  rootFilter?: (node: T) => boolean;
  disabled?: boolean;
  /** Base id for the 3 `Combobox`es (`${idBase}-level-1/2/3`) — a wrapping
   * `<Label htmlFor>` should point at `${idBase}-level-1`. */
  idBase: string;
  /** Base accessible label, suffixed per level (e.g. "Activity subtype —
   * level 2") — a single visible `<Label>` above the whole 3-up row is the
   * expected usage (see the two call sites in `activity-assignment-section.tsx`),
   * this only covers the 2nd/3rd levels' own `aria-label` since a `<label
   * for>` can target just one control. */
  ariaLabel: string;
  placeholder?: string;
}

function sortNodes<T extends SubtypeCascadeNode>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

function rootsOf<T extends SubtypeCascadeNode>(nodes: T[]): T[] {
  return sortNodes(nodes.filter((node) => node.parent_subtype_id === null));
}

function childrenOf<T extends SubtypeCascadeNode>(nodes: T[], parentId: string): T[] {
  if (!parentId) return [];
  return sortNodes(nodes.filter((node) => node.parent_subtype_id === parentId));
}

/**
 * Walks `value` up via `parent_subtype_id` to derive this component's own 3
 * displayed levels — mirrors `topArticleGroupAncestorId`'s ancestor-walk
 * style (`../group-tree.ts`), generalized to a caller-supplied flat node
 * list: this component is shared across two distinct trees (Activity
 * subtype/Solution subtype), so it can't import either tree's own
 * tree-specific helpers (`topActivitySubtypeAncestorId`/
 * `topSolutionSubtypeAncestorId`) without picking a side.
 *
 * Assumes `value` is at most 3 levels deep (root -> mid -> leaf) — this
 * picker's own UI only ever exposes 3 levels ("Ga nu uit van 3 lagen diep"),
 * even though both underlying trees are genuinely unlimited-depth. A value
 * deeper than that is a Settings-tree-manager edge case outside this
 * picker's current scope; `chain[0..2]` below silently keeps only the
 * nearest-to-root 3 in that case rather than crashing.
 */
function deriveLevels<T extends SubtypeCascadeNode>(nodes: T[], value: string): [string, string, string] {
  if (!value) return ["", "", ""];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: string[] = [];
  let current = byId.get(value);
  while (current) {
    chain.unshift(current.id);
    current = current.parent_subtype_id ? byId.get(current.parent_subtype_id) : undefined;
  }
  return [chain[0] ?? "", chain[1] ?? "", chain[2] ?? ""];
}

/**
 * Shared 3-level cascading picker (issues #134/#138) — used once for Activity
 * subtype (`activity-assignment-section.tsx`, `rootFilter`-scoped to the
 * current Activity Type) and once for Solution subtype
 * (`activity-solution-section.tsx`, no `rootFilter`). 3 `Combobox`es stacked
 * one below the other (issue #152's follow-up — they used to sit side by
 * side in a `FormGrid columns={3}`, which read as cramped once the whole
 * picker itself was squeezed into one half of an outer 2-column row next to
 * its paired Description/Solution field): top = roots, middle = the selected
 * root's children, bottom = the selected middle node's children — same
 * search-dropdown primitive `article-classification-section.tsx`'s
 * Group/Subgroup pair uses, extended one level deeper.
 *
 * Committing behavior mirrors that Group/Subgroup pair exactly, extended to 3
 * levels: picking ANY level immediately commits `onChange` with that level's
 * own id (even if it has children) — a deeper level populating underneath it
 * is a further, optional refinement of an already-valid, already-committed
 * pick, not a requirement to go deeper. Picking a shallower level always
 * clears every deeper level's own local selection and re-commits to the new
 * shallower node. Every level is individually `clearable` (its own "x"
 * resets that level, and everything under it, via `onChange`), which also
 * covers this component's "clear the whole pick" requirement when used on
 * level 1.
 *
 * Re-derives its own 3 displayed levels from `value` (via `deriveLevels`
 * above) on mount AND whenever `value`/`nodes` change from OUTSIDE this
 * component (editing an existing activity that already has a deep pick;
 * `activity-screen.tsx`'s own Cancel resetting the draft; the Activity-Type-
 * changed auto-clear also in `activity-screen.tsx`). This is safe to run
 * unconditionally on every `value` change, including ones this component's
 * own `onChange` just caused: every local pick already sets its own levels
 * AND calls `onChange` with the exact value `deriveLevels` would derive right
 * back to, so the effect is idempotent for every internally-driven change and
 * only ever produces a visibly different result for a genuinely external one.
 */
export function SubtypeCascadePicker<T extends SubtypeCascadeNode>({
  nodes,
  value,
  onChange,
  rootFilter,
  disabled,
  idBase,
  ariaLabel,
  placeholder = "Search…",
}: SubtypeCascadePickerProps<T>) {
  const [levels, setLevels] = useState<[string, string, string]>(() => deriveLevels(nodes, value));
  const [level1, level2, level3] = levels;

  useEffect(() => {
    setLevels(deriveLevels(nodes, value));
  }, [nodes, value]);

  const level1Options = useMemo(() => {
    const roots = rootsOf(nodes);
    return (rootFilter ? roots.filter(rootFilter) : roots).map((node) => ({ value: node.id, label: node.name }));
  }, [nodes, rootFilter]);

  const level2Options = useMemo(
    () => childrenOf(nodes, level1).map((node) => ({ value: node.id, label: node.name })),
    [nodes, level1],
  );

  const level3Options = useMemo(
    () => childrenOf(nodes, level2).map((node) => ({ value: node.id, label: node.name })),
    [nodes, level2],
  );

  function handleLevel1Change(nextId: string) {
    setLevels([nextId, "", ""]);
    onChange(nextId || "");
  }

  function handleLevel2Change(nextId: string) {
    setLevels([level1, nextId, ""]);
    onChange(nextId || level1 || "");
  }

  function handleLevel3Change(nextId: string) {
    setLevels([level1, level2, nextId]);
    onChange(nextId || level2 || level1 || "");
  }

  return (
    <Stack gap="xs">
      <Combobox
        id={`${idBase}-level-1`}
        aria-label={`${ariaLabel} — level 1`}
        options={level1Options}
        value={level1}
        onChange={handleLevel1Change}
        placeholder={placeholder}
        disabled={disabled}
        clearable
        emptyMessage="No options configured."
      />
      <Combobox
        id={`${idBase}-level-2`}
        aria-label={`${ariaLabel} — level 2`}
        options={level2Options}
        value={level2}
        onChange={handleLevel2Change}
        placeholder={level1 ? placeholder : "Select the previous level first…"}
        disabled={disabled || !level1}
        clearable
        emptyMessage="No sub-options under this selection."
      />
      <Combobox
        id={`${idBase}-level-3`}
        aria-label={`${ariaLabel} — level 3`}
        options={level3Options}
        value={level3}
        onChange={handleLevel3Change}
        placeholder={level2 ? placeholder : "Select the previous level first…"}
        disabled={disabled || !level2}
        clearable
        emptyMessage="No sub-options under this selection."
      />
    </Stack>
  );
}
