"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Combobox,
  Disclosure,
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
import { Boxes, Trash2 } from "@yourorg/ui/icons";
import {
  removeContractArticleGroupRule,
  removeContractArticleRule,
  setContractArticleGroupRule,
  setContractArticleRule,
  type ContractArticleGroupRuleRecord,
  type ContractArticleRuleRecord,
} from "../actions";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import { buildArticleGroupTree, type ArticleGroupTreeNode } from "@/app/(app)/articles/group-tree";
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

/** The three states a coverage control can be in — `"none"` means no rule row
 * exists at all (neither included nor excluded), `"covered"` maps to
 * `is_excluded: true` (covered by the contract, excluded from separate
 * invoicing), `"billed"` maps to `is_excluded: false` (explicitly NOT
 * covered, bill it separately). See the migration's own comment on
 * `contract_article_group_rules.is_excluded` for the exact framing. */
type CoverageState = "none" | "covered" | "billed";

function coverageStateFromRule(rule: { is_excluded: boolean } | undefined): CoverageState {
  if (!rule) return "none";
  return rule.is_excluded ? "covered" : "billed";
}

/**
 * "Article coverage" section (issue #122) — per-contract include/exclude
 * marking against the Article Group tree and individual articles, for a
 * future Quote-generation story to consume (not built here). Two sub-lists:
 * Article groups (the org's whole tree, rendered as a nested `Disclosure`
 * exactly like `app/(app)/settings/components/article-group-manager.tsx`,
 * each row getting a "No rule"/"Covered"/"Bill separately" control) and
 * Individual articles (a `Combobox`-driven add flow + a row list of existing
 * rules). Edit-mode-only — `ContractScreen` never renders this before the
 * contract exists.
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
  const [addArticleId, setAddArticleId] = useState("");
  const [addState, setAddState] = useState<CoverageState>("covered");

  const tree = useMemo(() => buildArticleGroupTree(articleGroups), [articleGroups]);
  const groupRuleByGroupId = useMemo(() => new Map(groupRules.map((rule) => [rule.article_group_id, rule])), [groupRules]);
  const articleRuleByArticleId = useMemo(() => new Map(articleRules.map((rule) => [rule.article_id, rule])), [articleRules]);
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);

  const canManage = canCreate || canDelete;

  function handleGroupRuleChange(groupId: string, next: CoverageState) {
    setError(null);
    startTransition(async () => {
      const result =
        next === "none"
          ? await removeContractArticleGroupRule(contractId, groupId)
          : await setContractArticleGroupRule({ contractId, articleGroupId: groupId, isExcluded: next === "covered" });
      if (!result.data) {
        setError(result.error ?? "Could not update this rule.");
        return;
      }
      router.refresh();
    });
  }

  function handleArticleRuleChange(articleId: string, next: CoverageState) {
    setError(null);
    startTransition(async () => {
      const result =
        next === "none"
          ? await removeContractArticleRule(contractId, articleId)
          : await setContractArticleRule({ contractId, articleId, isExcluded: next === "covered" });
      if (!result.data) {
        setError(result.error ?? "Could not update this rule.");
        return;
      }
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
        isExcluded: addState === "covered",
      });
      if (!result.data) {
        setError(result.error ?? "Could not add this rule.");
        return;
      }
      setAddArticleId("");
      setAddState("covered");
      router.refresh();
    });
  }

  const articleOptions: ComboboxOption[] = articles
    .filter((article) => !articleRuleByArticleId.has(article.id))
    .map((article) => ({
      value: article.id,
      label: `${article.article_number} — ${article.description}`,
      keywords: [article.ean, article.gtin, article.mpn].filter(Boolean).join(" "),
    }));

  return (
    <Stack gap="lg">
      <SectionHeader icon={Boxes} title="Article coverage" />
      {error && <Text tone="danger">{error}</Text>}

      <Stack gap="sm">
        <Heading level={4}>Article groups</Heading>
        {tree.length === 0 ? (
          <EmptyState icon={<Boxes />} heading="No article groups configured" text="Nothing to cover yet." />
        ) : (
          <Stack gap="sm">
            {tree.map((node) => (
              <GroupCoverageNode
                key={node.group.id}
                node={node}
                depth={0}
                ruleByGroupId={groupRuleByGroupId}
                canManage={canManage}
                isPending={isPending}
                onChange={handleGroupRuleChange}
              />
            ))}
          </Stack>
        )}
      </Stack>

      <Stack gap="sm">
        <Heading level={4}>Individual articles</Heading>

        {articleRules.length === 0 ? (
          <EmptyState icon={<Boxes />} heading="No individual article rules yet" text="Add an article rule below if needed." />
        ) : (
          <Stack gap="xs">
            {articleRules.map((rule) => {
              const article = articleById.get(rule.article_id);
              return (
                <Inline key={rule.id} gap="sm" align="center" justify="between">
                  <Text>{article ? `${article.article_number} — ${article.description}` : "Unknown article"}</Text>
                  <Inline gap="xs" align="center">
                    {canManage ? (
                      <Select
                        aria-label="Coverage"
                        value={coverageStateFromRule(rule)}
                        disabled={isPending}
                        onChange={(event) => handleArticleRuleChange(rule.article_id, event.target.value as CoverageState)}
                      >
                        <option value="none">No rule</option>
                        <option value="covered">Covered</option>
                        <option value="billed">Bill separately</option>
                      </Select>
                    ) : (
                      <Badge variant="muted">{rule.is_excluded ? "Covered" : "Bill separately"}</Badge>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        aria-label="Remove rule"
                        disabled={isPending}
                        onClick={() => handleArticleRuleChange(rule.article_id, "none")}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </Inline>
                </Inline>
              );
            })}
          </Stack>
        )}

        {canCreate && (
          <Stack gap="sm">
            <Text tone="muted">Add a rule for an individual article:</Text>
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
                value={addState}
                onChange={(event) => setAddState(event.target.value as CoverageState)}
              >
                <option value="covered">Covered</option>
                <option value="billed">Bill separately</option>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={handleAddArticleRule} disabled={!addArticleId || isPending}>
                Add rule
              </Button>
            </Inline>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

function GroupCoverageNode({
  node,
  depth,
  ruleByGroupId,
  canManage,
  isPending,
  onChange,
}: {
  node: ArticleGroupTreeNode;
  depth: number;
  ruleByGroupId: Map<string, ContractArticleGroupRuleRecord>;
  canManage: boolean;
  isPending: boolean;
  onChange: (groupId: string, next: CoverageState) => void;
}) {
  const rule = ruleByGroupId.get(node.group.id);
  // Wrapped in a click-stopping span — a `<summary>`'s native "toggle on
  // click" activation fires on ANY click within it (including a nested
  // `<select>`, which is itself a click target to open its own dropdown)
  // unless that click is stopped from bubbling, same reasoning
  // `article-group-manager.tsx`'s own `GroupNode` gives for its own action
  // buttons (there via `event.preventDefault()` on each button's own click;
  // here via `stopPropagation` on the wrapping span, since a native `<select>`
  // has no single click handler of its own to hook).
  const control = canManage ? (
    <span onClick={(event) => event.stopPropagation()}>
      <Select
        aria-label={`Coverage for ${node.group.name}`}
        value={coverageStateFromRule(rule)}
        disabled={isPending}
        onChange={(event) => onChange(node.group.id, event.target.value as CoverageState)}
      >
        <option value="none">No rule</option>
        <option value="covered">Covered</option>
        <option value="billed">Bill separately</option>
      </Select>
    </span>
  ) : (
    <Badge variant="muted">{rule ? (rule.is_excluded ? "Covered" : "Bill separately") : "No rule"}</Badge>
  );

  if (node.children.length === 0) {
    return (
      <Inline gap="sm" align="center" justify="between">
        <Text>{node.group.name}</Text>
        {control}
      </Inline>
    );
  }

  return (
    <Disclosure defaultOpen={depth === 0}>
      <Disclosure.Summary meta={control}>{node.group.name}</Disclosure.Summary>
      <Disclosure.Content>
        <Stack gap="sm" style={{ paddingLeft: "1.25rem" }}>
          {node.children.map((child) => (
            <GroupCoverageNode
              key={child.group.id}
              node={child}
              depth={depth + 1}
              ruleByGroupId={ruleByGroupId}
              canManage={canManage}
              isPending={isPending}
              onChange={onChange}
            />
          ))}
        </Stack>
      </Disclosure.Content>
    </Disclosure>
  );
}
