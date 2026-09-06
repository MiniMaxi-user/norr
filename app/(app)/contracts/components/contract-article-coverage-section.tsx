"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Combobox,
  Dialog,
  EmptyState,
  FormGrid,
  Heading,
  Inline,
  Label,
  RadioGroup,
  RadioGroupItem,
  RowCard,
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
 * Revision: adding a rule is a single "+ Rule" popup (`ContractCoverageRuleDialog`
 * below, same "+ Article"/"+ Asset" header-action shape every other section
 * on this page uses) instead of two permanently-visible inline forms — a
 * radio toggle inside picks group vs. article, then a search-driven
 * `Combobox` scoped to that choice (`flattenArticleGroups`'s "Parent > Child"
 * path as the searchable group label, so a subgroup is reachable directly
 * without browsing the whole tree — same "search and add" pattern
 * `ContractLineItemsSection`'s article picker already uses). Existing rules
 * (both groups and individual articles) are shown under two column headings,
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

  const [addOpen, setAddOpen] = useState(false);

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

  async function handleAddRule(kind: "group" | "article", id: string, state: CoverageState): Promise<{ ok: boolean; error?: string }> {
    const result =
      kind === "group"
        ? await setContractArticleGroupRule({ contractId, articleGroupId: id, isExcluded: state === "included" })
        : await setContractArticleRule({ contractId, articleId: id, isExcluded: state === "included" });
    if (!result.data) return { ok: false, error: result.error ?? "Could not add this rule." };
    router.refresh();
    return { ok: true };
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
      <RowCard>
        <div className="ui-row-main">
          <Inline gap="xs" align="center">
            <Badge variant={row.kind === "group" ? "accent" : "success"}>{row.kind === "group" ? "Group" : "Article"}</Badge>
            <Text>{row.label}</Text>
          </Inline>
        </div>
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
      </RowCard>
    );
  }

  return (
    <Stack gap="lg">
      <SectionHeader
        icon={Boxes}
        title="Article coverage"
        actions={
          canCreate && (
            <Button type="button" variant="primary" size="sm" onClick={() => setAddOpen(true)}>
              + Rule
            </Button>
          )
        }
      />
      {error && <Text tone="danger">{error}</Text>}

      <FormGrid columns={2}>
        <Stack gap="sm">
          <Heading level={6}>Included</Heading>
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
          <Heading level={6}>Excluded</Heading>
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
      </FormGrid>

      {addOpen && (
        <ContractCoverageRuleDialog
          open
          onOpenChange={setAddOpen}
          groupOptions={groupOptions}
          articleOptions={articleOptions}
          onSave={handleAddRule}
        />
      )}
    </Stack>
  );
}

/**
 * "+ Rule" popup behind `ContractArticleCoverageSection`'s header action —
 * a radio toggle picks article group vs. individual article, then a search
 * `Combobox` scoped to that choice. Mirrors `ContractLineItemDialog`'s
 * Dialog.Header/Body/Footer shape (`./contract-line-items-section.tsx`).
 */
function ContractCoverageRuleDialog({
  open,
  onOpenChange,
  groupOptions,
  articleOptions,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupOptions: ComboboxOption[];
  articleOptions: ComboboxOption[];
  onSave: (kind: "group" | "article", id: string, state: CoverageState) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [kind, setKind] = useState<"group" | "article">("group");
  const [lookupId, setLookupId] = useState("");
  const [coverageState, setCoverageState] = useState<CoverageState>("included");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleKindChange(next: "group" | "article") {
    setKind(next);
    setLookupId("");
    setError(null);
  }

  async function handleSave() {
    if (!lookupId) {
      setError(kind === "group" ? "Select an article group." : "Select an article.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave(kind, lookupId, coverageState);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add this rule.");
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Add rule</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          <RadioGroup>
            <Inline gap="md">
              <Label>
                <RadioGroupItem name="contract-coverage-rule-kind" checked={kind === "group"} onChange={() => handleKindChange("group")} />{" "}
                Article group
              </Label>
              <Label>
                <RadioGroupItem name="contract-coverage-rule-kind" checked={kind === "article"} onChange={() => handleKindChange("article")} />{" "}
                Article
              </Label>
            </Inline>
          </RadioGroup>

          <Stack gap="xs">
            <Label htmlFor="contract-coverage-rule-lookup">{kind === "group" ? "Article group" : "Article"}</Label>
            <Combobox
              id="contract-coverage-rule-lookup"
              options={kind === "group" ? groupOptions : articleOptions}
              value={lookupId}
              onChange={setLookupId}
              placeholder={kind === "group" ? "Search groups and subgroups…" : "Search by article number or description…"}
              emptyMessage={kind === "group" ? "No matching groups" : "No matching articles"}
            />
          </Stack>

          <Stack gap="xs">
            <Label htmlFor="contract-coverage-rule-state">Coverage</Label>
            <Select
              id="contract-coverage-rule-state"
              value={coverageState}
              onChange={(event) => setCoverageState(event.target.value as CoverageState)}
            >
              <option value="included">Included</option>
              <option value="excluded">Excluded</option>
            </Select>
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Add rule"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
