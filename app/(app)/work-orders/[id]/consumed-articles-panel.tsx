"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Heading, Inline, Input, Select, Stack, Table, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import {
  createWorkOrderArticle,
  updateWorkOrderArticle,
  type WorkOrderArticleRecord,
} from "../work-order-articles-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatCurrency } from "@/lib/format/currency";
import { DeleteWorkOrderArticleDialog } from "./delete-work-order-article-dialog";

export interface ConsumedArticlesPanelProps {
  workOrderId: string;
  /** Via `listWorkOrderArticles` — for an engineer caller this is already
   * scoped to their own rows by RLS (`work_order_articles_select_scoped`),
   * same "no app-layer re-filtering needed" lesson `listTimeEntries`
   * documents in `../time-entries-actions.ts`. */
  workOrderArticles: WorkOrderArticleRecord[];
  /** `listArticlesForSelect()` — every active article in this org, for the
   * "which article was consumed" picker (same source `RateSettingsSection`
   * uses for its own Travel/Work-time article pickers, issue #93). */
  articles: ArticleSelectOption[];
  /** This org's members, to resolve a row's `created_by` into a display name
   * (`memberDisplayName`) — same directory `time-entries-panel.tsx` uses for
   * `time_entries.user_id`. */
  members: OrgMemberRecord[];
  currentUserId: string;
  /** `canAny(actor, "planning", ["create", "create_own"])` — every role that
   * can log time can also log a consumed article; unlike Time Entries there
   * is no "on behalf of" concept here (`work_order_articles.created_by` is
   * ALWAYS the caller, never settable — see `work-order-articles-actions.ts`'s
   * module comment), so there is only one "Add" gate, not a further
   * `canLogTimeForOthers`-style split. */
  canCreate: boolean;
  /** `can(actor, "planning", "update")` — owner/planner can edit ANY row. */
  canUpdateAny: boolean;
  /** `can(actor, "planning", "update_own")` — an engineer can only edit a
   * row they themselves logged; checked per-row below against
   * `row.created_by`, same shape `TimeEntriesPanel` checks `entry.user_id`. */
  canUpdateOwn: boolean;
  /** `can(actor, "planning", "delete")` — owner/planner only; an engineer has
   * no delete action here either (same as Time Entries). */
  canDelete: boolean;
}

/** The inline row editor's in-progress values — `rowId: null` means "not
 * saved yet" (an Add in progress), same shape `TimeEntriesPanel`'s `RowDraft`
 * uses for its own new-vs-existing distinction. */
interface RowDraft {
  rowId: string | null;
  articleId: string;
  quantity: string;
}

function articleLabel(article: { article_number: string; description: string } | null): string {
  if (!article) return "—";
  return `${article.article_number} — ${article.description}`;
}

/**
 * "Consumed Articles" — the `work_order_articles` sub-resource of one Work
 * Order (issue #94), surfaced in-context on its detail page at the same
 * placement tier as `TimeEntriesPanel`/`ChecklistPanel` (a compact list is
 * the right weight here per docs/ARCHITECTURE.md "Relational detail pages" /
 * "Popup vs. full page" — not a separate route).
 *
 * Interaction pattern mirrors `TimeEntriesPanel` post-issue-#89: "Add
 * article" appends a new editable row directly into the `<Table>` (article
 * picker + quantity input) rather than opening a `Dialog`, and a row's own
 * "Edit" turns that same row into the identical editable shape in place.
 * Delete stays a `ConfirmDeleteDialog`-based confirm
 * (`DeleteWorkOrderArticleDialog`), same weight `DeleteTimeEntryDialog`
 * gives its own sibling sub-resource.
 *
 * Each row's live sale price is shown (read straight off the embedded
 * `article.sale_price` — `work_order_articles` itself stores no price column
 * at all, see that table's own migration design note) purely as a preview of
 * what "Maak Quote" will bill this line at; it is not editable here.
 */
export function ConsumedArticlesPanel({
  workOrderId,
  workOrderArticles,
  articles,
  members,
  currentUserId,
  canCreate,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
}: ConsumedArticlesPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [deletingRow, setDeletingRow] = useState<WorkOrderArticleRecord | null>(null);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const showActionsColumn = canUpdateAny || canUpdateOwn || canDelete;

  function startAdd() {
    setError(null);
    setDraft({ rowId: null, articleId: "", quantity: "1" });
  }

  function startEdit(row: WorkOrderArticleRecord) {
    setError(null);
    setDraft({ rowId: row.id, articleId: row.article_id, quantity: String(row.quantity) });
  }

  function updateDraft(patch: Partial<RowDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function cancelDraft() {
    setDraft(null);
    setError(null);
  }

  function saveDraft() {
    if (!draft) return;
    const quantity = Number(draft.quantity);
    if (!draft.articleId) {
      setError("Select an article.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const result = draft.rowId
        ? await updateWorkOrderArticle(draft.rowId, { articleId: draft.articleId, quantity })
        : await createWorkOrderArticle(workOrderId, { articleId: draft.articleId, quantity });
      setSaving(false);
      if (!result.data) {
        setError(result.error ?? "Could not save this consumed article.");
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function renderDraftRow(key: string) {
    return (
      <Table.Row key={key}>
        <Table.Cell>
          <Select
            autoFocus
            aria-label="Article"
            value={draft!.articleId}
            onChange={(event) => updateDraft({ articleId: event.target.value })}
            disabled={saving}
          >
            <option value="" disabled>
              Select an article…
            </option>
            {articles.map((article) => (
              <option key={article.id} value={article.id}>
                {article.article_number} — {article.description}
              </option>
            ))}
          </Select>
        </Table.Cell>
        <Table.Cell>
          <Input
            aria-label="Quantity"
            type="number"
            step="0.001"
            min="0.001"
            value={draft!.quantity}
            onChange={(event) => updateDraft({ quantity: event.target.value })}
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>—</Table.Cell>
        <Table.Cell>—</Table.Cell>
        {showActionsColumn && (
          <Table.Cell align="center">
            <Inline gap="sm" align="center">
              <Button type="button" variant="primary" size="sm" onClick={saveDraft} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelDraft} disabled={saving}>
                Cancel
              </Button>
            </Inline>
          </Table.Cell>
        )}
      </Table.Row>
    );
  }

  const newRowDraft = draft && draft.rowId === null ? draft : null;
  const hasAnyRows = workOrderArticles.length > 0 || newRowDraft !== null;

  return (
    <Card>
      <Stack gap="lg">
        <Inline gap="sm" align="center" justify="between">
          <Heading level={3}>Consumed Articles</Heading>
          {canCreate && (
            <Button type="button" variant="outline" size="sm" onClick={startAdd} disabled={draft !== null}>
              Add article
            </Button>
          )}
        </Inline>
        {error && <Text tone="danger">{error}</Text>}

        {!hasAnyRows ? (
          <EmptyState
            icon={<Boxes />}
            heading="No consumed articles logged yet"
            text="Log a material or part consumed on this work order so it can be billed on the resulting quote."
          />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Article</Table.HeaderCell>
                <Table.HeaderCell>Quantity</Table.HeaderCell>
                <Table.HeaderCell>Sale price</Table.HeaderCell>
                <Table.HeaderCell>Logged by</Table.HeaderCell>
                {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {workOrderArticles.map((row) => {
                if (draft && draft.rowId === row.id) {
                  return renderDraftRow(row.id);
                }
                // An engineer (update_own only) can only edit their own row —
                // RLS (`work_order_articles_update_scoped`) enforces this
                // independently regardless, this is purely so the button
                // isn't shown for a row it would just fail on. Same shape
                // `TimeEntriesPanel`'s own `canEditRow` uses.
                const canEditRow = canUpdateAny || (canUpdateOwn && row.created_by === currentUserId);
                return (
                  <Table.Row key={row.id}>
                    <Table.Cell>{articleLabel(row.article)}</Table.Cell>
                    <Table.Cell>{row.quantity}</Table.Cell>
                    <Table.Cell>{formatCurrency(row.article?.sale_price ?? null)}</Table.Cell>
                    <Table.Cell>{row.created_by ? memberDisplayName(memberById.get(row.created_by)) : "—"}</Table.Cell>
                    {showActionsColumn && (
                      <Table.Cell align="center">
                        <Inline gap="sm" align="center">
                          {canEditRow && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => startEdit(row)}
                              disabled={draft !== null}
                            >
                              Edit
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => setDeletingRow(row)}
                              disabled={draft !== null}
                            >
                              Delete
                            </Button>
                          )}
                        </Inline>
                      </Table.Cell>
                    )}
                  </Table.Row>
                );
              })}
              {newRowDraft && renderDraftRow("new-row-draft")}
            </Table.Body>
          </Table>
        )}
      </Stack>

      {deletingRow && (
        <DeleteWorkOrderArticleDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeletingRow(null);
          }}
          workOrderArticle={deletingRow}
        />
      )}
    </Card>
  );
}
