"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  Heading,
  Inline,
  Label,
  Select,
  SectionHeader,
  Stack,
  Text,
  type ComboboxOption,
} from "@yourorg/ui";
import { Boxes, FileText, Trash2 } from "@yourorg/ui/icons";
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

export interface ContractArticleCoverageSectionProps {
  contractId: string;
  articleGroups: ArticleGroupRecord[];
  articles: ArticleSelectOption[];
  groupRules: ContractArticleGroupRuleRecord[];
  articleRules: ContractArticleRuleRecord[];
  canCreate: boolean;
  canDelete: boolean;
}

/** The two real states a rule can be in — `"included"` maps to
 * `is_excluded: true` (covered by the contract, excluded from separate
 * invoicing — the wording flips here because "included"/"excluded" in this
 * UI means "part of this contract's coverage" or not, not the DB column's
 * own "excluded from separate invoicing" framing). `"none"` is UI-only
 * (removes the rule row entirely — it's never a stored state, see
 * `handleRuleChange` below). */
type CoverageState = "included" | "excluded";
type RuleChoice = "none" | CoverageState;

function coverageStateFromRule(rule: { is_excluded: boolean }): CoverageState {
  return rule.is_excluded ? "included" : "excluded";
}

/** One row in either the "Included" or "Excluded" list — a group or an
 * article rule, tagged so the row can show which kind it is and dispatch to
 * the right pair of Server Actions. */
type CoverageRow =
  | { kind: "group"; id: string; label: string; rule: ContractArticleGroupRuleRecord }
  | { kind: "article"; id: string; label: string; rule: ContractArticleRuleRecord };

/**
 * "Article coverage" section (issue #122, revised) — per-contract include/
 * exclude marking against the Article Group tree and individual articles,
 * for a future Quote-generation story to consume (not built here).
 *
 * Revision: adding a group rule is now a search-driven `Combobox` flow
 * (`flattenArticleGroups`'s "Parent > Child" path as the searchable label,
 * so a subgroup is reachable directly without browsing the whole tree) —
 * same "search and add," not "browse and toggle every node," pattern
 * `ContractLineItemsSection`'s article picker already uses — replacing the
 * previous full nested `Disclosure` tree render entirely. Existing rules
 * (both groups and individual articles) are now shown under two headings,
 * "Included" (covered by the contract) and "Excluded" (billed separately),
 * each row tagged with a small Group/Article badge and a `<Select>` to
 * change or remove ("No rule") it.
 */
export function ContractArticleCoverageSection({
  contractId,
  articleGroups,
  articles,
  groupRules,
  articleRules,
  canCreate,
  canDelete,
}: ContractArticleCoverageSectionProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [addGroupId, setAddGroupId] = useState("");
  const [addGroupState, setAddGroupState] = useState<CoverageState>("included");
  const [addArticleId, setAddArticleId] = useState("");
  const [addArticleState, setAddArticleState] = useState<CoverageState>("included");

  const flattenedGroups = useMemo(() => flattenArticleGroups(articleGroups), [articleGroups]);
  const groupPathById = useMemo(() => new Map(flattenedGroups.map((group) => [group.id, group.path])), [flattenedGroups]);
  const articleLabelById = useMemo(
    () => new Map(articles.map((article) => [article.id, `${article.article_number} — ${article.description}`])),
    [articles],
  );

  const ruledGroupIds = useMemo(() => new Set(groupRules.map((rule) => rule.article_group_id)), [groupRules]);
  const ruledArticleIds = useMemo(() => new Set(articleRules.map((rule) => rule.article_id)), [articleRules]);

  const canManage = canCreate || canDelete;

  const allRows: CoverageRow[] = useMemo(
    () => [
      ...groupRules.map((rule): CoverageRow => ({
        kind: "group",
        id: rule.article_group_id,
        label: groupPathById.get(rule.article_group_id) ?? "Unknown group",
        rule,
      })),
      ...articleRules.map((rule): CoverageRow => ({
        kind: "article",
        id: rule.article_id,
        label: articleLabelById.get(rule.article_id) ?? "Unknown article",
        rule,
      })),
    ],
    [groupRules, articleRules, groupPathById, articleLabelById],
  );

  const includedRows = allRows.filter((row) => row.rule.is_excluded);
  const excludedRows = allRows.filter((row) => !row.rule.is_excluded);

  function handleRuleChange(row: CoverageRow, next: RuleChoice) {
    setError(null);
    startTransition(async () => {
      const result =
        row.kind === "group"
          ? next === "none"
            ? await removeContractArticleGroupRule(contractId, row.id)
            : await setContractArticleGroupRule({ contractId, articleGroupId: row.id, isExcluded: next === "included" })
          : next === "none"
            ? await removeContractArticleRule(contractId, row.id)
            : await setContractArticleRule({ contractId, articleId: row.id, isExcluded: next === "included" });
      if (!result.data) {
        setError(result.error ?? "Could not update this rule.");
        return;
      }
      router.refresh();
    });
  }

  function handleAddGroupRule() {
    if (!addGroupId) {
      setError("Select an article group.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setContractArticleGroupRule({
        contractId,
        articleGroupId: addGroupId,
        isExcluded: addGroupState === "included",
      });
      if (!result.data) {
        setError(result.error ?? "Could not add this rule.");
        return;
      }
      setAddGroupId("");
      setAddGroupState("included");
      router.refresh();
    });
  }

  function handleAddArticleRule() {
    if (!addArticleId) {
      setError("Select an article.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setContractArticleRule({
        contractId,
        articleId: addArticleId,
        isExcluded: addArticleState === "included",
      });
      if (!result.data) {
        setError(result.error ?? "Could not add this rule.");
        return;
      }
      setAddArticleId("");
      setAddArticleState("included");
      router.refresh();
    });
  }

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

  function RuleRow({ row }: { row: CoverageRow }) {
    return (
      <Inline gap="sm" align="center" justify="between">
        <Inline gap="xs" align="center">
          <Badge variant="muted">{row.kind === "group" ? "Group" : "Article"}</Badge>
          <Text>{row.label}</Text>
        </Inline>
        <Inline gap="xs" align="center">
          {canManage ? (
            <Select
              aria-label="Coverage"
              value={coverageStateFromRule(row.rule)}
              disabled={isPending}
              onChange={(event) => handleRuleChange(row, event.target.value as RuleChoice)}
            >
              <option value="included">Included</option>
              <option value="excluded">Excluded</option>
              <option value="none">No rule</option>
            </Select>
          ) : (
            <Badge variant="muted">{row.rule.is_excluded ? "Included" : "Excluded"}</Badge>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              aria-label="Remove rule"
              disabled={isPending}
              onClick={() => handleRuleChange(row, "none")}
            >
              <Trash2 />
            </Button>
          )}
        </Inline>
      </Inline>
    );
  }

  return (
    <Stack gap="lg">
      <SectionHeader icon={Boxes} title="Article coverage" />
      {error && <Text tone="danger">{error}</Text>}

      {canCreate && (
        <Stack gap="md">
          <Stack gap="xs">
            <Text tone="muted">Add an article group (or subgroup):</Text>
            <Inline gap="sm" align="center">
              <div style={{ flex: 1 }}>
                <Label htmlFor="contract-coverage-add-group">Article group</Label>
                <Combobox
                  id="contract-coverage-add-group"
                  options={groupOptions}
                  value={addGroupId}
                  onChange={setAddGroupId}
                  placeholder="Search groups and subgroups…"
                  emptyMessage="No matching groups"
                />
              </div>
              <Select aria-label="Coverage" value={addGroupState} onChange={(event) => setAddGroupState(event.target.value as CoverageState)}>
                <option value="included">Included</option>
                <option value="excluded">Excluded</option>
              </Select>
              <Button type="button" variant="primary" size="sm" onClick={handleAddGroupRule} disabled={!addGroupId || isPending}>
                Add rule
              </Button>
            </Inline>
          </Stack>

          <Stack gap="xs">
            <Text tone="muted">Add an individual article:</Text>
            <Inline gap="sm" align="center">
              <div style={{ flex: 1 }}>
                <Label htmlFor="contract-coverage-add-article">Article</Label>
                <Combobox
                  id="contract-coverage-add-article"
                  options={articleOptions}
                  value={addArticleId}
                  onChange={setAddArticleId}
                  placeholder="Search by article number or description…"
                  emptyMessage="No matching articles"
                />
              </div>
              <Select
                aria-label="Coverage"
                value={addArticleState}
                onChange={(event) => setAddArticleState(event.target.value as CoverageState)}
              >
                <option value="included">Included</option>
                <option value="excluded">Excluded</option>
              </Select>
              <Button type="button" variant="primary" size="sm" onClick={handleAddArticleRule} disabled={!addArticleId || isPending}>
                Add rule
              </Button>
            </Inline>
          </Stack>
        </Stack>
      )}

      <Stack gap="sm">
        <Heading level={4}>Included</Heading>
        {includedRows.length === 0 ? (
          <EmptyState icon={<FileText />} heading="Nothing marked included yet" text="Covered by the contract, excluded from separate invoicing." />
        ) : (
          <Stack gap="xs">
            {includedRows.map((row) => (
              <RuleRow key={`${row.kind}-${row.id}`} row={row} />
            ))}
          </Stack>
        )}
      </Stack>

      <Stack gap="sm">
        <Heading level={4}>Excluded</Heading>
        {excludedRows.length === 0 ? (
          <EmptyState icon={<FileText />} heading="Nothing marked excluded yet" text="Explicitly not covered — billed separately." />
        ) : (
          <Stack gap="xs">
            {excludedRows.map((row) => (
              <RuleRow key={`${row.kind}-${row.id}`} row={row} />
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
