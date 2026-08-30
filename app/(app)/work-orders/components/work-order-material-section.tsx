"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, EmptyState, Input, Label, RowCard, SectionHeader, Select, Stack, SummaryRow, Text, Tooltip } from "@yourorg/ui";
import { Boxes, Pencil, Trash2 } from "@yourorg/ui/icons";
import { createWorkOrderArticle, updateWorkOrderArticle, type WorkOrderArticleRecord } from "../work-order-articles-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatCurrency } from "@/lib/format/currency";
import { DeleteWorkOrderArticleDialog } from "./delete-work-order-article-dialog";

export interface WorkOrderMaterialSectionProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  workOrderId?: string;
  workOrderArticles: WorkOrderArticleRecord[];
  articles: ArticleSelectOption[];
  canCreate: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  canDelete: boolean;
  currentUserId?: string;
}

/**
 * "Material" column (issue #102) — replaces `ConsumedArticlesPanel`'s old
 * `<Table>` with a compact row list + `SummaryRow` total, and moves
 * "+ Article" from an inline draft table row (issue #89's pattern) to a
 * small `Dialog` popup, per the issue's own explicit ask. Same
 * `createWorkOrderArticle`/`updateWorkOrderArticle` calls underneath —
 * only the surrounding UI shape changed. `mode: "create"` disables
 * "+ Article" with an explanatory tooltip rather than hiding the section.
 */
export function WorkOrderMaterialSection({
  mode,
  workOrderId,
  workOrderArticles,
  articles,
  canCreate,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
  currentUserId,
}: WorkOrderMaterialSectionProps) {
  const [adding, setAdding] = useState(false);
  const [editingRow, setEditingRow] = useState<WorkOrderArticleRecord | null>(null);
  const [deletingRow, setDeletingRow] = useState<WorkOrderArticleRecord | null>(null);

  const total = workOrderArticles.reduce((sum, row) => sum + row.quantity * (row.article?.sale_price ?? 0), 0);

  return (
    <Stack gap="md">
      <SectionHeader
        icon={Boxes}
        title="Material"
        actions={
          mode === "create" ? (
            <Tooltip content="Save the work order first">
              <Button type="button" variant="outline" size="sm" disabled>
                + Article
              </Button>
            </Tooltip>
          ) : (
            canCreate && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
                + Article
              </Button>
            )
          )
        }
      />

      {workOrderArticles.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          heading="No consumed articles logged yet"
          text={
            mode === "create"
              ? "Save the work order first to start logging consumed material."
              : "Log a material or part consumed on this work order so it can be billed on the resulting quote."
          }
        />
      ) : (
        <>
          <Stack gap="xs">
            {workOrderArticles.map((row) => {
              const canEditRow = canUpdateAny || (canUpdateOwn && row.created_by === currentUserId);
              return (
                <RowCard key={row.id}>
                  <div className="ui-work-order-row-main">
                    <Text>{row.article?.description ?? "—"}</Text>
                    <Text tone="muted" className="ui-work-order-article-number">
                      {row.article?.article_number}
                    </Text>
                  </div>
                  <Text tone="muted" className="ui-tabular-nums">
                    {row.quantity} × {formatCurrency(row.article?.sale_price ?? null)}
                  </Text>
                  <Text className="ui-work-order-row-trailing ui-tabular-nums">
                    {formatCurrency(row.quantity * (row.article?.sale_price ?? 0))}
                  </Text>
                  <span className="ui-row-actions">
                    {canEditRow && (
                      <Button type="button" variant="outline" size="sm" aria-label="Edit" onClick={() => setEditingRow(row)}>
                        <Pencil />
                      </Button>
                    )}
                    {canDelete && (
                      <Button type="button" variant="danger" size="sm" aria-label="Delete" onClick={() => setDeletingRow(row)}>
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                </RowCard>
              );
            })}
          </Stack>
          <SummaryRow items={[{ label: "Total", value: formatCurrency(total), emphasis: "serif" }]} />
        </>
      )}

      {adding && workOrderId && (
        <WorkOrderArticleDialog
          open
          onOpenChange={(open) => !open && setAdding(false)}
          workOrderId={workOrderId}
          row={null}
          articles={articles}
        />
      )}
      {editingRow && (
        <WorkOrderArticleDialog
          open
          onOpenChange={(open) => !open && setEditingRow(null)}
          workOrderId={workOrderId!}
          row={editingRow}
          articles={articles}
        />
      )}
      {deletingRow && (
        <DeleteWorkOrderArticleDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeletingRow(null);
          }}
          workOrderArticle={deletingRow}
        />
      )}
    </Stack>
  );
}

function WorkOrderArticleDialog({
  open,
  onOpenChange,
  workOrderId,
  row,
  articles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  row: WorkOrderArticleRecord | null;
  articles: ArticleSelectOption[];
}) {
  const router = useRouter();
  const [articleId, setArticleId] = useState(row?.article_id ?? "");
  const [quantity, setQuantity] = useState(row ? String(row.quantity) : "1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const parsedQuantity = Number(quantity);
    if (!articleId) {
      setError("Select an article.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = row
      ? await updateWorkOrderArticle(row.id, { articleId, quantity: parsedQuantity })
      : await createWorkOrderArticle(workOrderId, { articleId, quantity: parsedQuantity });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not save this consumed article.");
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>{row ? "Edit consumed article" : "Add article"}</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="wo-article">Article</Label>
            <Select id="wo-article" value={articleId} onChange={(event) => setArticleId(event.target.value)}>
              <option value="" disabled>
                Select an article…
              </option>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.article_number} — {article.description}
                </option>
              ))}
            </Select>
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="wo-article-quantity">Quantity</Label>
            <Input
              id="wo-article-quantity"
              type="number"
              step="0.001"
              min="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
