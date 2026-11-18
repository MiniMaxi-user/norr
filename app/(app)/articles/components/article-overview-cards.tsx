"use client";

import { useMemo } from "react";
import { WebCardStack } from "@yourorg/ui/web";
import { KeyValueCard, type EditModeApi, type KvEditBinder, type KvField, type KvOption } from "@yourorg/ui/web-client";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ArticleRecord } from "../actions";
import {
  findArticleGroup,
  isArticleGroupDescendantOf,
  type FlattenedArticleGroup,
} from "../group-tree";
import type { ArticleDraft } from "./article-draft";
import { formatPriceWeb } from "./article-format";

export interface ArticleReferenceLists {
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
}

export interface ArticleOverviewCardsProps {
  edit: EditModeApi<ArticleDraft>;
  article?: ArticleRecord;
  lists: ArticleReferenceLists;
  isNew: boolean;
}

function toNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The Overview tab's card (design system, issue #222): ONE two-column
 * "Details" card — identity and classification on the left (article number,
 * description, manufacturer, MPN, EAN, GTIN, group, subgroup), pricing and
 * state on the right (unit, purchase and sale price, VAT rate, active,
 * composite, photo URL). Articles have no notes field, so there is no Notes
 * card. Everything is edited from the page header's single Edit button.
 *
 * Group > Subgroup is a cascade over the tenant's article-group tree: the
 * Subgroup select is disabled with an explanation until a group is chosen and
 * is cleared when the group changes. A legacy assignment deeper than two levels
 * stays visible: the Subgroup list then widens to every descendant, labelled
 * with its full path.
 */
export function ArticleOverviewCards({ edit, article, lists, isNew }: ArticleOverviewCardsProps) {
  const saved = edit.record;
  const draft = edit.draft;
  const { groups, units, manufacturers, vatRates } = lists;

  // Cascade: wrap the binder instead of special-casing the card.
  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof ArticleDraft & string);
        if (key === "groupId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              edit.setValue("subgroupId", "");
            },
          };
        }
        return binding;
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit],
  );

  // --- Read values ----------------------------------------------------------
  const savedLeafGroup = findArticleGroup(groups, saved.subgroupId || saved.groupId);
  const savedGroup = findArticleGroup(groups, saved.groupId)?.name ?? (saved.groupId ? article?.article_group?.name : "");
  const savedSubgroup = savedLeafGroup && savedLeafGroup.depth > 0 ? savedLeafGroup.name : "";
  const labelOf = (items: ReferenceListItemRecord[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.label ?? fallback ?? "";

  // --- Options --------------------------------------------------------------
  const topLevelGroups = useMemo(() => groups.filter((group) => group.depth === 0), [groups]);
  const directSubgroups = useMemo(
    () => groups.filter((group) => group.depth === 1 && group.parentId === draft.groupId),
    [groups, draft.groupId],
  );
  // Depth-2+ fallback: the selected subgroup is not a direct (depth-1) child of
  // the group, so it is a deeper legacy assignment — widen the list to every
  // descendant, labelled with its full path, so the value is not silently lost.
  const subgroupIsDeep = Boolean(draft.subgroupId) && !directSubgroups.some((group) => group.id === draft.subgroupId);
  const subgroupOptions: KvOption[] = useMemo(() => {
    if (subgroupIsDeep) {
      return groups
        .filter((group) => group.depth > 0 && isArticleGroupDescendantOf(groups, group, draft.groupId))
        .map((group) => ({ value: group.id, label: group.path }));
    }
    return directSubgroups.map((group) => ({ value: group.id, label: group.name }));
  }, [groups, directSubgroups, subgroupIsDeep, draft.groupId]);

  const groupOptions = topLevelGroups.map((group) => ({ value: group.id, label: group.name }));
  const manufacturerOptions = manufacturers
    .filter((item) => item.is_active !== false || item.id === draft.manufacturerItemId)
    .map((item) => ({ value: item.id, label: item.label }));
  const unitOptions = units
    .filter((item) => item.is_active !== false || item.id === draft.unitItemId)
    .map((item) => ({ value: item.id, label: item.label }));
  const vatOptions = vatRates
    .filter((item) => item.is_active !== false || item.id === draft.vatRateItemId)
    .map((item) => ({ value: item.id, label: item.label }));

  const left: KvField[] = [
    { key: "articleNumber", label: "Article number", mono: true, read: saved.articleNumber, maxLength: 100 },
    { key: "description", label: "Description", read: saved.description, maxLength: 2000 },
    {
      key: "manufacturerItemId",
      label: "Manufacturer",
      kind: "select",
      read: labelOf(
        manufacturers,
        saved.manufacturerItemId,
        saved.manufacturerItemId === article?.manufacturer_item_id ? article?.article_manufacturer?.label : null,
      ),
      options: manufacturerOptions,
      emptyLabel: "No manufacturer",
    },
    { key: "mpn", label: "MPN", mono: true, read: saved.mpn, placeholder: "Manufacturer part number", maxLength: 100 },
    { key: "ean", label: "EAN", mono: true, read: saved.ean, maxLength: 64 },
    { key: "gtin", label: "GTIN", mono: true, read: saved.gtin, maxLength: 64 },
    {
      key: "groupId",
      label: "Group",
      kind: "select",
      read: savedGroup,
      options: groupOptions,
      emptyLabel: groupOptions.length === 0 ? "No groups configured" : "No group",
    },
    {
      key: "subgroupId",
      label: "Subgroup",
      kind: "select",
      read: savedSubgroup,
      options: subgroupOptions,
      emptyLabel: "No subgroup",
      disabled: !draft.groupId,
      disabledNote: "Choose a group first",
    },
  ];

  const defaultUnit = units.find((item) => item.is_default);
  const defaultVat = vatRates.find((item) => item.is_default);

  const right: KvField[] = [
    {
      key: "unitItemId",
      label: "Unit",
      kind: "select",
      read: labelOf(units, saved.unitItemId, saved.unitItemId === article?.unit_item_id ? article?.article_unit?.label : null),
      options: unitOptions,
      emptyLabel: isNew && defaultUnit ? `Use default (${defaultUnit.label})` : "Select a unit…",
    },
    {
      key: "purchasePrice",
      label: "Purchase price",
      kind: "money",
      step: "0.0001",
      read: toNumber(saved.purchasePrice) === null ? null : formatPriceWeb(toNumber(saved.purchasePrice)),
    },
    {
      key: "salePrice",
      label: "Sale price",
      kind: "money",
      step: "0.0001",
      read: toNumber(saved.salePrice) === null ? null : formatPriceWeb(toNumber(saved.salePrice)),
    },
    {
      key: "vatRateItemId",
      label: "VAT rate",
      kind: "select",
      read: article?.vat_rate && saved.vatRateItemId === article.vat_rate_item_id
        ? `${article.vat_rate.value}%`
        : labelOf(vatRates, saved.vatRateItemId),
      options: vatOptions,
      emptyLabel: isNew && defaultVat ? `Use default (${defaultVat.label})` : "Select a VAT rate…",
    },
    {
      key: "isActive",
      label: "Active",
      kind: "checkbox",
      checkboxLabel: "Active",
      read: saved.isActive ? "Active" : "Inactive",
    },
    {
      key: "isComposite",
      label: "Composite",
      kind: "checkbox",
      checkboxLabel: "Composite article (has a bill of materials)",
      read: saved.isComposite ? "Yes" : "No",
    },
    {
      key: "imageUrl",
      label: "Photo URL",
      read: saved.imageUrl,
      placeholder: "https://…",
      maxLength: 2000,
    },
  ];

  return (
    <WebCardStack>
      <KeyValueCard title="Details" columns={2} split={left.length} fields={[...left, ...right]} edit={binder} />
    </WebCardStack>
  );
}
