"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Combobox, EditableSection, FormGrid, Inline, KeyValueList, Label, Select, Stack, Text } from "@yourorg/ui";
import { Settings } from "@yourorg/ui/icons";
import type { ArticleRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { FlattenedArticleGroup } from "../group-tree";
import { findArticleGroup, isArticleGroupDescendantOf, topArticleGroupAncestorId } from "../group-tree";
import type { ArticleDraft } from "./article-draft";

export interface ArticleClassificationSectionProps {
  mode: "create" | "edit";
  draft: Pick<ArticleDraft, "groupId" | "manufacturerItemId" | "unitItemId">;
  article?: ArticleRecord;
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  editing: boolean;
  onEditToggle?: (editing: boolean) => void;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ArticleDraft, "groupId" | "manufacturerItemId" | "unitItemId">,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** `mode: "edit"` only — see `ArticleInfoSectionProps.onFieldChange`'s own
   * doc comment. */
  onFieldChange?: (patch: Partial<Pick<ArticleDraft, "groupId" | "manufacturerItemId" | "unitItemId">>) => void;
}

/**
 * "Classification" section (issue #123, converting the old `ArticleFormPanel`
 * slide-in) — the Group/Subgroup cascade, Manufacturer, and Unit. The
 * Group/Subgroup cascade logic (a top-level `Combobox` plus a dependent
 * subgroup `Combobox`, with a depth-2+ fallback showing the full breadcrumb
 * `path` for a legacy deep assignment) is carried over from that panel
 * unchanged — see `topArticleGroupAncestorId`/`isArticleGroupDescendantOf`
 * (moved to `../group-tree.ts` in this same pass) for the non-trivial
 * tree-walking it depends on. Only a single `groupId` (the more specific of
 * the two cascade levels) is ever part of `ArticleDraft`/persisted — the
 * top/subgroup split is local UI state derived from it, same "one committed
 * value, a richer local cascade selection" shape `AssetEquipmentSection`'s
 * Type/Sub-type pair uses.
 */
export function ArticleClassificationSection({
  mode,
  draft,
  article,
  groups,
  units,
  manufacturers,
  editing,
  onEditToggle,
  readOnly,
  onSave,
  onFieldChange,
}: ArticleClassificationSectionProps) {
  const [topGroupId, setTopGroupId] = useState(() => topArticleGroupAncestorId(groups, draft.groupId));
  const [subGroupId, setSubGroupId] = useState(() => {
    const node = findArticleGroup(groups, draft.groupId);
    return node && node.depth > 0 ? node.id : "";
  });
  const [manufacturerItemId, setManufacturerItemId] = useState(draft.manufacturerItemId);
  const [unitItemId, setUnitItemId] = useState(draft.unitItemId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setTopGroupId(topArticleGroupAncestorId(groups, draft.groupId));
    const node = findArticleGroup(groups, draft.groupId);
    setSubGroupId(node && node.depth > 0 ? node.id : "");
    setManufacturerItemId(draft.manufacturerItemId);
    setUnitItemId(draft.unitItemId);
    setError(null);
    // Only re-seed on the open transition itself — same "open re-seeds, not
    // every keystroke" contract every other inline edit in this codebase
    // follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const topLevelGroups = useMemo(() => groups.filter((group) => group.depth === 0), [groups]);
  const directSubgroups = useMemo(
    () => groups.filter((group) => group.depth === 1 && group.parentId === topGroupId),
    [groups, topGroupId],
  );
  // Depth-2+ fallback: if the currently selected subgroup isn't among
  // `topGroupId`'s direct (depth-1) children, it must be a deeper legacy
  // assignment (a group tree can be unlimited depth) — widen the picker to
  // every descendant of the selected top group (any depth), labeled with its
  // full breadcrumb `path` for disambiguation, so the existing value stays
  // visible/selectable rather than silently lost.
  const subgroupIsDeepFallback = Boolean(subGroupId) && !directSubgroups.some((group) => group.id === subGroupId);
  const deepDescendants = useMemo(
    () => (subgroupIsDeepFallback ? groups.filter((group) => group.depth > 0 && isArticleGroupDescendantOf(groups, group, topGroupId)) : []),
    [groups, subgroupIsDeepFallback, topGroupId],
  );
  const subgroupOptions = (subgroupIsDeepFallback ? deepDescendants : directSubgroups).map((group) => ({
    value: group.id,
    label: subgroupIsDeepFallback ? group.path : group.name,
  }));

  // In `mode: "edit"` the top/subgroup cascade selection itself has nowhere
  // to live but local state (only the resolved leaf `groupId` is a real
  // `ArticleDraft` field) — but every change here also writes straight
  // through to `onFieldChange` so the shared `draft` (and this screen's
  // single Save) stays in sync, same "controlled off the shared draft"
  // contract every other field on this screen now follows.
  function handleTopGroupChange(value: string) {
    setTopGroupId(value);
    setSubGroupId("");
    if (mode === "edit") onFieldChange?.({ groupId: value || "" });
  }

  function handleSubGroupChange(value: string) {
    setSubGroupId(value);
    if (mode === "edit") onFieldChange?.({ groupId: value || topGroupId || "" });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ groupId: subGroupId || topGroupId || "", manufacturerItemId, unitItemId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") onEditToggle?.(false);
  }

  const defaultUnit = units.find((item) => item.is_default);
  const groupPath = findArticleGroup(groups, draft.groupId)?.path ?? article?.article_group?.name ?? "—";

  return (
    <EditableSection
      icon={Settings}
      title="Classification"
      editing={editing}
      onEdit={mode === "edit" || readOnly ? undefined : () => onEditToggle?.(true)}
      editLabel="Edit classification"
      editContent={
        <Stack gap="md">
          {mode !== "edit" && error && <Text tone="danger">{error}</Text>}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="article-cls-group">Group</Label>
              <Combobox
                id="article-cls-group"
                options={topLevelGroups.map((group) => ({ value: group.id, label: group.name }))}
                value={topGroupId}
                onChange={handleTopGroupChange}
                placeholder="Search groups…"
                clearable
                emptyMessage="No groups configured."
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-cls-subgroup">Subgroup</Label>
              <Combobox
                id="article-cls-subgroup"
                options={subgroupOptions}
                value={subGroupId}
                onChange={handleSubGroupChange}
                placeholder={topGroupId ? "Search subgroups…" : "Select a group first…"}
                disabled={!topGroupId}
                clearable
                emptyMessage="No subgroups under this group."
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-cls-manufacturer">Manufacturer</Label>
              <Select
                id="article-cls-manufacturer"
                value={mode === "edit" ? draft.manufacturerItemId : manufacturerItemId}
                onChange={(event) =>
                  mode === "edit"
                    ? onFieldChange?.({ manufacturerItemId: event.target.value })
                    : setManufacturerItemId(event.target.value)
                }
              >
                <option value="">No manufacturer</option>
                {manufacturers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="article-cls-unit">Unit</Label>
              <Select
                id="article-cls-unit"
                value={mode === "edit" ? draft.unitItemId : unitItemId}
                onChange={(event) =>
                  mode === "edit" ? onFieldChange?.({ unitItemId: event.target.value }) : setUnitItemId(event.target.value)
                }
              >
                <option value="">{defaultUnit ? `Use default (${defaultUnit.label})` : "Use organization default"}</option>
                {units.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Stack>
          </FormGrid>
          {mode !== "edit" && (
            <Inline gap="sm" justify="end">
              <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </Inline>
          )}
        </Stack>
      }
    >
      <KeyValueList
        items={[
          { key: "group", label: "Group", value: <Text>{groupPath}</Text> },
          { key: "manufacturer", label: "Manufacturer", value: <Text>{article?.article_manufacturer?.label ?? "—"}</Text> },
          { key: "unit", label: "Unit", value: <Text>{article?.article_unit?.label ?? "—"}</Text> },
        ]}
      />
    </EditableSection>
  );
}
