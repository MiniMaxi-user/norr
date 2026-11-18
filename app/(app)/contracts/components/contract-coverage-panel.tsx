"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox, toast, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  removeContractArticleGroupRule,
  removeContractArticleRule,
  setContractArticleGroupRule,
  setContractArticleRule,
  type ContractArticleGroupRuleRecord,
  type ContractArticleRuleRecord,
} from "../actions";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { flattenArticleGroups } from "@/app/(app)/articles/group-tree";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";

export interface ContractCoveragePanelProps {
  contractId: string;
  articleGroups: ArticleGroupRecord[];
  articles: ArticleSelectOption[];
  groupRules: ContractArticleGroupRuleRecord[];
  articleRules: ContractArticleRuleRecord[];
  canCreate: boolean;
  canDelete: boolean;
}

/** `is_excluded = true` on the DB row means "covered by the contract, excluded
 * from separate invoicing" — shown here as Included; `false` is explicitly not
 * covered (Excluded, billed separately). */
type CoverageState = "included" | "excluded";

const stateOf = (rule: { is_excluded: boolean }): CoverageState => (rule.is_excluded ? "included" : "excluded");
const stateLabel = (state: CoverageState) => (state === "included" ? "Included" : "Excluded");

type CoverageRow =
  | { kind: "group"; key: string; id: string; label: string; rule: ContractArticleGroupRuleRecord }
  | { kind: "article"; key: string; id: string; label: string; rule: ContractArticleRuleRecord };

/**
 * Article coverage tab (design system, issue #222): the per-contract
 * include/exclude rules against article groups and individual articles, as one
 * card with a FilterBar and a table. `+ Rule` opens the small dialog (group or
 * article, search, coverage); switching a rule between Included and Excluded
 * and removing it live in one ··· menu per row.
 */
export function ContractCoveragePanel({
  contractId,
  articleGroups,
  articles,
  groupRules,
  articleRules,
  canCreate,
  canDelete,
}: ContractCoveragePanelProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<CoverageRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);

  const canManage = canCreate || canDelete;

  const flattenedGroups = useMemo(() => flattenArticleGroups(articleGroups), [articleGroups]);
  const groupPathById = useMemo(() => new Map(flattenedGroups.map((group) => [group.id, group.path])), [flattenedGroups]);
  const articleLabelById = useMemo(
    () => new Map(articles.map((article) => [article.id, `${article.article_number} — ${article.description}`])),
    [articles],
  );

  const rows = useMemo<CoverageRow[]>(
    () => [
      ...groupRules.map(
        (rule): CoverageRow => ({
          kind: "group",
          key: `group-${rule.article_group_id}`,
          id: rule.article_group_id,
          label: groupPathById.get(rule.article_group_id) ?? "Unknown group",
          rule,
        }),
      ),
      ...articleRules.map(
        (rule): CoverageRow => ({
          kind: "article",
          key: `article-${rule.article_id}`,
          id: rule.article_id,
          label: articleLabelById.get(rule.article_id) ?? "Unknown article",
          rule,
        }),
      ),
    ],
    [groupRules, articleRules, groupPathById, articleLabelById],
  );

  const ruledGroupIds = useMemo(() => new Set(groupRules.map((rule) => rule.article_group_id)), [groupRules]);
  const ruledArticleIds = useMemo(() => new Set(articleRules.map((rule) => rule.article_id)), [articleRules]);

  const includedCount = rows.filter((row) => row.rule.is_excluded).length;

  async function setState(row: CoverageRow, state: CoverageState) {
    const isExcluded = state === "included";
    const result =
      row.kind === "group"
        ? await setContractArticleGroupRule({ contractId, articleGroupId: row.id, isExcluded })
        : await setContractArticleRule({ contractId, articleId: row.id, isExcluded });
    if (!result.data) {
      toast({
        title: "Rule not changed",
        description: result.error ?? "Could not update this rule. Try again.",
        tone: "danger",
        duration: 6000,
      });
      return;
    }
    toast({ title: `Marked as ${stateLabel(state).toLowerCase()}`, duration: 3000 });
    router.refresh();
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemovePending(true);
    setRemoveError(null);
    const result =
      removing.kind === "group"
        ? await removeContractArticleGroupRule(contractId, removing.id)
        : await removeContractArticleRule(contractId, removing.id);
    setRemovePending(false);
    if (!result.data) {
      setRemoveError(result.error ?? "Could not remove this rule.");
      return;
    }
    setRemoving(null);
    router.refresh();
  }

  const columns = useMemo<WebColumn<CoverageRow>[]>(
    () => [
      { id: "rule", header: "Rule", sortValue: (row) => row.label, render: (row) => row.label },
      {
        id: "kind",
        header: "Applies to",
        sortValue: (row) => row.kind,
        render: (row) => (row.kind === "group" ? "Article group" : "Article"),
      },
      {
        id: "coverage",
        header: "Coverage",
        sortValue: (row) => stateOf(row.rule),
        render: (row) => stateLabel(stateOf(row.rule)),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "kind",
        label: "Applies to",
        getOptions: (row: CoverageRow) => [
          row.kind === "group" ? { value: "group", label: "Article group" } : { value: "article", label: "Article" },
        ],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show rules",
      defaultValue: "all",
      options: [
        { value: "included", label: "Included", match: (row: CoverageRow) => row.rule.is_excluded },
        { value: "excluded", label: "Excluded", match: (row: CoverageRow) => !row.rule.is_excluded },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: CoverageRow): WebMenuItem[] => {
    const items: WebMenuItem[] = [];
    if (canManage) {
      const next: CoverageState = stateOf(row.rule) === "included" ? "excluded" : "included";
      items.push({
        key: "toggle",
        label: next === "included" ? "Mark as included" : "Mark as excluded",
        onSelect: () => void setState(row, next),
      });
    }
    if (canDelete) {
      if (items.length > 0) items.push({ type: "separator", key: "sep" });
      items.push({
        key: "remove",
        label: "Remove rule",
        danger: true,
        onSelect: () => {
          setRemoveError(null);
          setRemoving(row);
        },
      });
    }
    return items;
  };

  const groupOptions: ComboboxOption[] = flattenedGroups
    .filter((group) => !ruledGroupIds.has(group.id))
    .map((group) => ({ value: group.id, label: group.path }));
  const articleOptions: ComboboxOption[] = articles
    .filter((article) => !ruledArticleIds.has(article.id))
    .map((article) => ({
      value: article.id,
      label: `${article.article_number} — ${article.description}`,
      keywords: [article.ean, article.gtin, article.mpn].filter(Boolean).join(" "),
    }));

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Article coverage"
        meta={`${rows.length} · ${includedCount} included`}
        rows={rows}
        getRowKey={(row) => row.key}
        columns={columns}
        searchText={(row) => row.label}
        noun="rules"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="coverage"
        defaultSort={{ columnId: "rule", direction: "asc" }}
        rowActions={rowActions}
        rowLabel={(row) => row.label}
        note="Included = covered by the contract and not invoiced separately. Excluded = billed separately."
        add={
          canCreate ? (
            <WebButton size="filter" onClick={() => setAddOpen(true)}>
              + Rule
            </WebButton>
          ) : undefined
        }
        emptyAction={canCreate ? "Use + Rule to mark an article group or article as included or excluded." : undefined}
      />

      {addOpen ? (
        <RuleDialog
          contractId={contractId}
          groupOptions={groupOptions}
          articleOptions={articleOptions}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      <WebConfirmDialog
        open={Boolean(removing)}
        title="Remove rule?"
        confirmLabel="Remove"
        confirmVariant="danger"
        pending={removePending}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        {removing ? <>The rule for {removing.label} is removed. Its coverage falls back to the default.</> : null}
      </WebConfirmDialog>
    </div>
  );
}

function RuleDialog({
  contractId,
  groupOptions,
  articleOptions,
  onClose,
}: {
  contractId: string;
  groupOptions: ComboboxOption[];
  articleOptions: ComboboxOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"group" | "article">("group");
  const [lookupId, setLookupId] = useState("");
  const [state, setState] = useState<CoverageState>("included");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeKind(next: "group" | "article") {
    setKind(next);
    setLookupId("");
    setError(null);
  }

  async function handleSave() {
    if (!lookupId) {
      setError(kind === "group" ? "Choose an article group" : "Choose an article");
      return;
    }
    setError(null);
    setSaving(true);
    const isExcluded = state === "included";
    const result =
      kind === "group"
        ? await setContractArticleGroupRule({ contractId, articleGroupId: lookupId, isExcluded })
        : await setContractArticleRule({ contractId, articleId: lookupId, isExcluded });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not add this rule.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <WebConfirmDialog
      open
      title="Add rule"
      confirmLabel="Add rule"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-rule-kind">
            Applies to
          </label>
          <select
            id="contract-rule-kind"
            className="web-select"
            value={kind}
            onChange={(event) => changeKind(event.target.value as "group" | "article")}
          >
            <option value="group">Article group</option>
            <option value="article">Article</option>
          </select>
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-rule-lookup">
            {kind === "group" ? "Article group" : "Article"}
          </label>
          <Combobox
            id="contract-rule-lookup"
            options={kind === "group" ? groupOptions : articleOptions}
            value={lookupId}
            onChange={setLookupId}
            placeholder={kind === "group" ? "Search groups and subgroups…" : "Search by article number or description…"}
            emptyMessage={kind === "group" ? "No matching groups" : "No matching articles"}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-rule-state">
            Coverage
          </label>
          <select
            id="contract-rule-state"
            className="web-select"
            value={state}
            onChange={(event) => setState(event.target.value as CoverageState)}
          >
            <option value="included">Included (covered by the contract)</option>
            <option value="excluded">Excluded (billed separately)</option>
          </select>
        </div>
      </div>
    </WebConfirmDialog>
  );
}
