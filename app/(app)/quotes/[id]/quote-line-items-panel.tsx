"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, Heading, Stack, Table, Text } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import type { QuoteLineItemRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { QuoteLineItemDialog } from "./quote-line-item-dialog";
import { DeleteQuoteLineItemDialog } from "./delete-quote-line-item-dialog";

export interface QuoteLineItemsPanelProps {
  quoteId: string;
  lineItems: QuoteLineItemRecord[];
  /** Assets belonging to the quote's own client — resolves each line item's
   * optional `asset_id` to a display name/link, and is the picker source in
   * `QuoteLineItemDialog`. */
  clientAssets: AssetRecord[];
  /** Gated on `can(actor, "quotes", "create")` — owner/planner only, matching
   * `createQuoteLineItem`'s own RBAC/RLS boundary. */
  canCreate: boolean;
  /** Gated on `can(actor, "quotes", "update")`. */
  canEdit: boolean;
  /** Gated on `can(actor, "quotes", "delete")`. */
  canDelete: boolean;
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function lineTotal(item: QuoteLineItemRecord): number {
  return Number(item.quantity) * Number(item.unit_price);
}

/**
 * "Line items" — the pricing rules within one quote, per docs/ARCHITECTURE.md
 * "Relational detail pages": a small editable table scoped to this quote,
 * surfaced as a section on the quote detail page (not a separate route — a
 * line item is a small flat record, same weight as Contacts/Sites on a
 * Client). Add/edit is a small `Dialog` (`QuoteLineItemDialog`); delete is
 * the existing small-confirm-dialog pattern (`DeleteQuoteLineItemDialog`).
 *
 * The grand total shown here matches the backend's own computed
 * `quote.total` (`sum(quantity * unit_price)`, see `app/(app)/quotes/
 * actions.ts`'s module comment) since it's derived from the exact same
 * `lineItems` this panel renders — no separate round trip, no drift.
 *
 * Read-only for anyone who can only `read` quotes (engineer/finance/
 * administratie) — no add/edit/delete affordances render for them at all,
 * matching `createQuoteLineItem`/`updateQuoteLineItem`/`deleteQuoteLineItem`'s
 * owner/planner-only RBAC gate.
 */
export function QuoteLineItemsPanel({
  quoteId,
  lineItems,
  clientAssets,
  canCreate,
  canEdit,
  canDelete,
}: QuoteLineItemsPanelProps) {
  const [addingItem, setAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState<QuoteLineItemRecord | null>(null);
  const [deletingItem, setDeletingItem] = useState<QuoteLineItemRecord | null>(null);

  const assetById = new Map(clientAssets.map((asset) => [asset.id, asset]));
  const grandTotal = lineItems.reduce((sum, item) => sum + lineTotal(item), 0);
  const showActionsColumn = canEdit || canDelete;

  return (
    <Card>
      <Stack gap="md">
        <Heading level={3}>Line items</Heading>

        {lineItems.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            heading="No line items yet"
            text="Add the priced items that make up this quote."
            action={canCreate ? <Button onClick={() => setAddingItem(true)}>Add line item</Button> : undefined}
          />
        ) : (
          <>
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.HeaderCell>Description</Table.HeaderCell>
                  <Table.HeaderCell>Asset</Table.HeaderCell>
                  <Table.HeaderCell align="center">Quantity</Table.HeaderCell>
                  <Table.HeaderCell>Unit price</Table.HeaderCell>
                  <Table.HeaderCell>Line total</Table.HeaderCell>
                  {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {lineItems.map((item) => {
                  const asset = item.asset_id ? assetById.get(item.asset_id) : undefined;
                  return (
                    <Table.Row key={item.id}>
                      <Table.Cell>{item.description}</Table.Cell>
                      <Table.Cell>
                        {item.asset_id ? asset ? <Link href={`/assets/${asset.id}`}>{asset.name}</Link> : "Unknown asset" : "—"}
                      </Table.Cell>
                      <Table.Cell align="center">{Number(item.quantity)}</Table.Cell>
                      <Table.Cell>{formatMoney(Number(item.unit_price))}</Table.Cell>
                      <Table.Cell>{formatMoney(lineTotal(item))}</Table.Cell>
                      {showActionsColumn && (
                        <Table.Cell align="center">
                          {canEdit && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setEditingItem(item)}>
                              Edit
                            </Button>
                          )}{" "}
                          {canDelete && (
                            <Button type="button" variant="danger" size="sm" onClick={() => setDeletingItem(item)}>
                              Delete
                            </Button>
                          )}
                        </Table.Cell>
                      )}
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>

            <Text>
              <strong>Total: {formatMoney(grandTotal)}</strong>
            </Text>

            {canCreate && (
              <div>
                <Button type="button" variant="outline" onClick={() => setAddingItem(true)}>
                  Add line item
                </Button>
              </div>
            )}
          </>
        )}
      </Stack>

      {addingItem && (
        <QuoteLineItemDialog
          quoteId={quoteId}
          clientAssets={clientAssets}
          open
          onOpenChange={(next) => setAddingItem(next)}
        />
      )}

      {editingItem && (
        <QuoteLineItemDialog
          quoteId={quoteId}
          lineItem={editingItem}
          clientAssets={clientAssets}
          open
          onOpenChange={(next) => !next && setEditingItem(null)}
        />
      )}

      {deletingItem && (
        <DeleteQuoteLineItemDialog
          lineItem={deletingItem}
          open
          onOpenChange={(next) => !next && setDeletingItem(null)}
        />
      )}
    </Card>
  );
}
