"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Combobox,
  EmptyState,
  Heading,
  Inline,
  Input,
  Select,
  Stack,
  SummaryRow,
  Table,
  Text,
} from "@yourorg/ui";
import type { ComboboxOption } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import { createQuoteLineItem, updateQuoteLineItem, type QuoteLineItemRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatCurrency } from "@/lib/format/currency";
import { DeleteQuoteLineItemDialog } from "./delete-quote-line-item-dialog";

export interface QuoteLineItemsPanelProps {
  quoteId: string;
  lineItems: QuoteLineItemRecord[];
  /** Assets belonging to the quote's own client — resolves each line item's
   * optional `asset_id` to a display name/link, and is the inline picker
   * source (issue #95 criterion 16: no navigation to `/assets/[id]`
   * required to pick or view one). */
  clientAssets: AssetRecord[];
  /** `listArticlesForSelect()`'s result — every active article in this org,
   * unpaginated. The inline article picker's option source; also feeds the
   * read-only purchase price/VAT preview for a NEWLY picked (not-yet-saved)
   * article, since the saved row's own `article` embed only exists after a
   * round trip. */
  articles: ArticleSelectOption[];
  /** This org's members — the inline engineer picker's option source and the
   * directory `memberDisplayName` resolves a saved row's raw
   * `engineer_user_id` against. */
  members: OrgMemberRecord[];
  /** Gated on `can(actor, "quotes", "create")` — owner/planner only, matching
   * `createQuoteLineItem`'s own RBAC/RLS boundary. */
  canCreate: boolean;
  /** Gated on `can(actor, "quotes", "update")`. */
  canEdit: boolean;
  /** Gated on `can(actor, "quotes", "delete")`. */
  canDelete: boolean;
}

/** The inline row editor's in-progress values — `rowId: null` means "not
 * saved yet" (an Add in progress), same shape `ConsumedArticlesPanel`'s/
 * `TimeEntriesPanel`'s own `RowDraft` use for their new-vs-existing
 * distinction. Every field is a plain string (form-input-shaped); parsed/
 * validated in `saveDraft` before being sent to the Server Action, which
 * re-validates independently regardless (`quoteLineItemCreateSchema`/
 * `quoteLineItemUpdateSchema`). `description` has no visible input anymore
 * (see `deriveDescription` below) but is still carried in the draft — it
 * still needs to survive an edit of an existing, already-described row
 * unchanged when neither the article nor the asset picker is touched. */
interface RowDraft {
  rowId: string | null;
  description: string;
  /** Independently editable/hand-typeable (issue "Deze separaat tonen in
   * quote") — decoupled from `description`: picking an article auto-fills
   * both from that article's own `article_number`/`description`, but a
   * free-text line item can also carry a manually typed article number with
   * no linked article at all, matching `articleNumber`'s nullable/optional
   * nature at the schema level (`quote_line_items.article_number`). */
  articleNumber: string;
  articleId: string;
  assetId: string;
  engineerId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
}

/** "Unit price incl. discount" = `unit_price * (1 - discount_percent / 100)`
 * (issue #95 criterion 6) — the stored `unit_price` column itself always
 * stays the pre-discount price; this is purely a display-layer computation,
 * same "no stored computed column" treatment `QuoteRecord.total`'s own
 * comment in `../actions.ts` documents. */
function unitPriceInclDiscount(unitPrice: number, discountPercent: number): number {
  return unitPrice * (1 - discountPercent / 100);
}

/** A line's row total = `quantity * (unit price incl. discount)` (criterion
 * 8) — matches `computeTotal` in `../actions.ts` term-for-term, just spelled
 * out per-row instead of summed. This is the quote's own pre-VAT figure
 * (`../actions.ts`'s `computeTotal` doc comment: `quote.total` is explicitly
 * pre-VAT) — the Subtotal/VAT/Total footer below sums exactly this. */
function rowTotal(quantity: number, unitPrice: number, discountPercent: number): number {
  return quantity * unitPriceInclDiscount(unitPrice, discountPercent);
}

function articleOptionLabel(article: { article_number: string; description: string }): string {
  return `${article.article_number} — ${article.description}`;
}

function assetOptionLabel(asset: AssetRecord): string {
  return asset.asset_type?.label ? `${asset.name} (${asset.asset_type.label})` : asset.name;
}

/** A line's own VAT rate, as a plain percentage number — resolved from its
 * linked article's `vat_rate.value` (a numeric string, e.g. `"21"`).
 * Deliberately `0` for a line with no linked article: `quote_line_items` has
 * no VAT-rate column of its own (only the linked article carries one), so
 * there is nothing to resolve a rate from for a free-text/manual line — this
 * is "no data to invent a number from", not a bug, same reasoning
 * `resolveArticlePriceInfo`'s own read-only VAT cell already applies
 * (renders "—" for exactly this case). */
function lineVatPercent(item: Pick<QuoteLineItemRecord, "article">): number {
  const raw = item.article?.vat_rate?.value;
  return raw ? Number(raw) : 0;
}

/** No visible "Description" input anymore (this file's own doc comment /
 * `docs/ARCHITECTURE.md`-adjacent redesign notes) — `description` stays a
 * required column (`quoteLineItemCreateSchema.description`, `min(1)`), so
 * every save still needs a non-empty value to send. Resolution order: (1)
 * whatever is already in the draft (auto-filled the moment an article is
 * picked, see `handleArticleChange`, or carried over unchanged from an
 * existing row being edited); (2) the picked asset's own display name, if
 * one is set but no article is; (3) a generic fallback. This is the
 * "narrow scope" choice flagged in the redesign hand-off: a brand new line
 * item with NEITHER an article NOR an asset picked no longer supports a
 * fully free-text description — it silently becomes "Line item" instead of
 * failing validation. Existing rows created before this redesign (with a
 * real hand-typed description) are unaffected — editing one without
 * changing its article/asset keeps its original text (case 1 above). */
function deriveDescription(draft: RowDraft, assetById: Map<string, AssetRecord>): string {
  const trimmed = draft.description.trim();
  if (trimmed) return trimmed;
  const asset = draft.assetId ? assetById.get(draft.assetId) : undefined;
  if (asset) return assetOptionLabel(asset);
  return "Line item";
}

/** Resolved purchase-price/VAT display for one row (read-only cells, issue
 * #95 criteria 3/4) — a small unified shape since the two sources this can
 * come from have different raw shapes: a NEWLY picked (not yet saved)
 * article off `articles` (`ArticleSelectOption`, `vat_rate_percent: number`)
 * vs. an already-saved line item's own embedded `article`
 * (`QuoteLineItemArticleEmbed`, `vat_rate: ResolvedReferenceItem`). */
interface ArticlePriceInfo {
  purchasePrice: number | null;
  vatLabel: string;
}

function resolveArticlePriceInfo(
  articleId: string,
  articleById: Map<string, ArticleSelectOption>,
  existing: QuoteLineItemRecord | null,
): ArticlePriceInfo | null {
  if (!articleId) return null;
  const active = articleById.get(articleId);
  if (active) {
    return {
      purchasePrice: active.purchase_price,
      vatLabel: active.vat_rate_percent !== null ? `${active.vat_rate_percent}%` : "—",
    };
  }
  // The picked article is no longer active (missing from `articleById`) but
  // is still this row's already-saved article — fall back to its embedded
  // display fields rather than showing nothing.
  if (existing && existing.article_id === articleId && existing.article) {
    return { purchasePrice: existing.article.purchase_price, vatLabel: existing.article.vat_rate?.label ?? "—" };
  }
  return null;
}

/**
 * "Line items" — the pricing rules within one quote (docs/ARCHITECTURE.md
 * "Relational detail pages"), a genuinely inline-editable table: no popup —
 * clicking anywhere in a saved row (not just a dedicated "Edit" button, now
 * removed as redundant) turns that row into the same editable shape "Add
 * line item" appends. Mirrors the interaction convention
 * `ConsumedArticlesPanel`/`TimeEntriesPanel` (issue #94/#89) already
 * established for this exact "inline-editable row with a picker for a
 * related entity + inputs, Save/Cancel" shape, rather than inventing a new
 * one — and deliberately NOT migrated to the newer `RowCard`+`Dialog` shape
 * `WorkOrderHoursSection`/`WorkOrderMaterialSection` use (that convention is
 * for a different kind of list; this one stays inline-editable by explicit
 * product direction). Delete stays a small `ConfirmDeleteDialog`-based
 * confirm (`DeleteQuoteLineItemDialog`) — same weight those panels give
 * their own sibling sub-resource's delete, and its own button
 * `stopPropagation`s so a Delete click never also triggers row-edit-mode.
 *
 * A row surfaces, left to right: Article (searchable by article number/EAN/
 * GTIN/description — `Combobox` with `keywords`, criterion 2 — no visible
 * Description column anymore, see `deriveDescription`'s own doc comment for
 * why and what narrowed), Asset (inline picker scoped to the quote's own
 * client, criterion 14/16), Engineer (inline picker, criterion 15),
 * Quantity, Unit price (the editable pre-discount sale price), Purchase
 * price (read-only, from the linked article, criterion 3), VAT (read-only,
 * from the linked article, criterion 4), Discount % (criterion 5), Unit
 * price incl. discount (computed, criterion 6), and Total (computed,
 * criterion 8).
 *
 * Picking an article auto-fills that row's Description + Unit price from the
 * chosen article's own `article_number`/`description`/`sale_price` (see
 * `handleArticleChange` below) — per `toQuoteLineItemInsertRow`'s own doc
 * comment in `../actions.ts`, which anticipates the frontend doing exactly
 * this rather than a redundant round trip back to the server.
 *
 * The Subtotal/VAT/Total footer (`SummaryRow`, below the table) matches the
 * backend's own computed `quote.total`/`listQuoteLineItems`'s own `total`
 * for the Subtotal figure (`sum(quantity * unit_price * (1 -
 * discount_percent / 100))`, pre-VAT) since it's derived from the exact same
 * `lineItems` this panel renders — no separate round trip, no drift. VAT is
 * computed per-line from that line's own linked article's VAT rate (`0` for
 * a line with no article, see `lineVatPercent`'s own doc comment) and
 * summed; Total is Subtotal + VAT.
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
  articles,
  members,
  canCreate,
  canEdit,
  canDelete,
}: QuoteLineItemsPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [deletingItem, setDeletingItem] = useState<QuoteLineItemRecord | null>(null);

  const assetById = useMemo(() => new Map(clientAssets.map((asset) => [asset.id, asset])), [clientAssets]);
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  // Only engineer-role members are a valid `engineer_user_id` — same
  // "engineer picker means engineer role" restriction `TimeEntriesPanel`'s
  // own `engineers` derivation documents.
  const engineers = useMemo(() => members.filter((member) => member.role === "engineer"), [members]);

  const articleOptions = useMemo<ComboboxOption[]>(
    () =>
      articles.map((article) => ({
        value: article.id,
        label: articleOptionLabel(article),
        keywords: [article.ean, article.gtin, article.mpn].filter(Boolean).join(" "),
      })),
    [articles],
  );

  const assetOptions = useMemo<ComboboxOption[]>(
    () =>
      clientAssets.map((asset) => ({
        value: asset.id,
        label: assetOptionLabel(asset),
        keywords: asset.serial_number ?? undefined,
      })),
    [clientAssets],
  );

  // Only Delete remains in the Actions column now (the standalone "Edit"
  // button is gone — clicking anywhere in the row does the same job, see
  // this file's own doc comment).
  const showActionsColumn = canDelete;

  const { subtotal, vatAmount, total } = useMemo(() => {
    let runningSubtotal = 0;
    let runningVat = 0;
    for (const item of lineItems) {
      const lineSubtotal = rowTotal(Number(item.quantity), Number(item.unit_price), Number(item.discount_percent));
      runningSubtotal += lineSubtotal;
      runningVat += lineSubtotal * (lineVatPercent(item) / 100);
    }
    return { subtotal: runningSubtotal, vatAmount: runningVat, total: runningSubtotal + runningVat };
  }, [lineItems]);

  function startAdd() {
    setError(null);
    setDraft({
      rowId: null,
      description: "",
      articleNumber: "",
      articleId: "",
      assetId: "",
      engineerId: "",
      quantity: "1",
      unitPrice: "0",
      discountPercent: "0",
    });
  }

  function startEdit(item: QuoteLineItemRecord) {
    setError(null);
    setDraft({
      rowId: item.id,
      description: item.description,
      articleNumber: item.article_number ?? "",
      articleId: item.article_id ?? "",
      assetId: item.asset_id ?? "",
      engineerId: item.engineer_user_id ?? "",
      quantity: String(item.quantity),
      unitPrice: String(item.unit_price),
      discountPercent: String(item.discount_percent ?? 0),
    });
  }

  function updateDraft(patch: Partial<RowDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  /** Selecting an article auto-fills Article number + Description + Unit
   * price from it, as three separate fields now — no more squashing article
   * number and description into one string (product ask: "Deze separaat
   * tonen in quote"). Clearing the picker (`articleId === ""`) leaves the
   * other fields as the user last set them (including a hand-typed
   * `articleNumber` on an otherwise-manual line); `deriveDescription`
   * resolves what actually gets sent at save time when no article ends up
   * picked. */
  function handleArticleChange(articleId: string) {
    const article = articleId ? articleById.get(articleId) : undefined;
    updateDraft({
      articleId,
      ...(article
        ? {
            articleNumber: article.article_number,
            description: article.description,
            unitPrice: String(article.sale_price ?? 0),
          }
        : {}),
    });
  }

  function cancelDraft() {
    setDraft(null);
    setError(null);
  }

  function saveDraft() {
    if (!draft) return;
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitPrice);
    const discountPercent = draft.discountPercent.trim() === "" ? 0 : Number(draft.discountPercent);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setError("Enter a valid unit price.");
      return;
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      setError("Discount must be between 0 and 100.");
      return;
    }

    setError(null);
    setSaving(true);
    startTransition(async () => {
      const input = {
        description: deriveDescription(draft, assetById),
        // Independent of `description`/`articleId` — a plain optional text
        // field (`quoteLineItemCreateSchema.articleNumber`), so an empty
        // string here is left as "not provided" by the schema's own
        // `optionalText` preprocessing (matching `notes`'s existing
        // treatment), not translated to an explicit `null` clear the way the
        // picker fields below are.
        articleNumber: draft.articleNumber.trim(),
        quantity,
        unitPrice,
        discountPercent,
        // `null` (not `undefined`) when empty: the draft always reflects the
        // row's full current state, so an empty picker here means the user
        // explicitly cleared a previously-set value, not that the field was
        // never touched — see `clearableUuid` in `../schema.ts`.
        assetId: draft.assetId || null,
        articleId: draft.articleId || null,
        engineerUserId: draft.engineerId || null,
      };
      const result = draft.rowId
        ? await updateQuoteLineItem(draft.rowId, input)
        : await createQuoteLineItem(quoteId, input);
      setSaving(false);
      if (!result.data) {
        setError(result.error ?? "Could not save this line item.");
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function renderDraftRow(key: string, existing: QuoteLineItemRecord | null) {
    const priceInfo = resolveArticlePriceInfo(draft!.articleId, articleById, existing);
    const quantity = Number(draft!.quantity);
    const unitPrice = Number(draft!.unitPrice);
    const discountPercent = Number(draft!.discountPercent);
    const inclDiscount =
      Number.isFinite(unitPrice) && Number.isFinite(discountPercent)
        ? unitPriceInclDiscount(unitPrice, discountPercent)
        : null;
    const total =
      Number.isFinite(quantity) && inclDiscount !== null ? quantity * inclDiscount : null;

    return (
      <Table.Row key={key}>
        <Table.Cell>
          <Stack gap="xs">
            <Combobox
              aria-label="Article"
              options={articleOptions}
              value={draft!.articleId}
              onChange={handleArticleChange}
              placeholder="Search article number, EAN, GTIN…"
              emptyMessage="No matching articles."
              clearable
              disabled={saving}
            />
            {/* Independent of the picker above — auto-filled the moment an
             * article is picked (`handleArticleChange`) but still a plain
             * editable text field, so a manual/free-text line item can carry
             * a hand-typed article number too (`articleNumber`'s nullable,
             * optional nature at the schema level). */}
            <Input
              aria-label="Article number"
              placeholder="Article number (optional)"
              value={draft!.articleNumber}
              onChange={(event) => updateDraft({ articleNumber: event.target.value })}
              disabled={saving}
            />
          </Stack>
        </Table.Cell>
        <Table.Cell>
          <Combobox
            aria-label="Asset"
            options={assetOptions}
            value={draft!.assetId}
            onChange={(value) => updateDraft({ assetId: value })}
            placeholder="No specific asset"
            emptyMessage="No matching assets."
            clearable
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>
          <Select
            aria-label="Engineer"
            value={draft!.engineerId}
            onChange={(event) => updateDraft({ engineerId: event.target.value })}
            disabled={saving}
          >
            <option value="">No engineer</option>
            {engineers.map((engineer) => (
              <option key={engineer.id} value={engineer.id}>
                {memberDisplayName(engineer)}
              </option>
            ))}
          </Select>
        </Table.Cell>
        <Table.Cell>
          <Input
            aria-label="Quantity"
            type="number"
            step="0.01"
            min="0.01"
            value={draft!.quantity}
            onChange={(event) => updateDraft({ quantity: event.target.value })}
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>
          <Input
            aria-label="Unit price"
            type="number"
            step="0.01"
            min="0"
            value={draft!.unitPrice}
            onChange={(event) => updateDraft({ unitPrice: event.target.value })}
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>{priceInfo ? formatCurrency(priceInfo.purchasePrice) : "—"}</Table.Cell>
        <Table.Cell>{priceInfo ? priceInfo.vatLabel : "—"}</Table.Cell>
        <Table.Cell>
          <Input
            aria-label="Discount %"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={draft!.discountPercent}
            onChange={(event) => updateDraft({ discountPercent: event.target.value })}
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>{inclDiscount !== null ? formatCurrency(inclDiscount) : "—"}</Table.Cell>
        <Table.Cell>{total !== null ? formatCurrency(total) : "—"}</Table.Cell>
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
  const hasAnyRows = lineItems.length > 0 || newRowDraft !== null;

  return (
    <Card>
      <Stack gap="md">
        <Heading level={3}>Line items</Heading>

        {error && <Text tone="danger">{error}</Text>}

        {!hasAnyRows ? (
          <EmptyState
            icon={<ClipboardList />}
            heading="No line items yet"
            text="Add the priced items that make up this quote."
            action={canCreate ? <Button size="sm" onClick={startAdd}>Add line item</Button> : undefined}
          />
        ) : (
          <>
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.HeaderCell>Article</Table.HeaderCell>
                  <Table.HeaderCell>Asset</Table.HeaderCell>
                  <Table.HeaderCell>Engineer</Table.HeaderCell>
                  <Table.HeaderCell align="center">Qty</Table.HeaderCell>
                  <Table.HeaderCell>Unit price</Table.HeaderCell>
                  <Table.HeaderCell>Purchase price</Table.HeaderCell>
                  <Table.HeaderCell>VAT</Table.HeaderCell>
                  <Table.HeaderCell>Discount %</Table.HeaderCell>
                  <Table.HeaderCell>Unit price (incl. discount)</Table.HeaderCell>
                  <Table.HeaderCell>Total</Table.HeaderCell>
                  {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {lineItems.map((item) => {
                  if (draft && draft.rowId === item.id) {
                    return renderDraftRow(item.id, item);
                  }
                  const asset = item.asset_id ? assetById.get(item.asset_id) : undefined;
                  const inclDiscount = unitPriceInclDiscount(Number(item.unit_price), Number(item.discount_percent));
                  const rowTotalValue = Number(item.quantity) * inclDiscount;
                  return (
                    <Table.Row
                      key={item.id}
                      onClick={canEdit && !draft ? () => startEdit(item) : undefined}
                    >
                      <Table.Cell>
                        <Stack gap="xs">
                          {item.article_number && <Text tone="muted">{item.article_number}</Text>}
                          <Text>{item.description}</Text>
                        </Stack>
                      </Table.Cell>
                      <Table.Cell>
                        {item.asset_id ? (
                          asset ? (
                            <Link href={`/assets/${asset.id}`} onClick={(event) => event.stopPropagation()}>
                              {assetOptionLabel(asset)}
                            </Link>
                          ) : (
                            "Unknown asset"
                          )
                        ) : (
                          "—"
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {item.engineer_user_id ? memberDisplayName(memberById.get(item.engineer_user_id)) : "—"}
                      </Table.Cell>
                      <Table.Cell align="center">{Number(item.quantity)}</Table.Cell>
                      <Table.Cell>{formatCurrency(Number(item.unit_price))}</Table.Cell>
                      <Table.Cell>{formatCurrency(item.article?.purchase_price ?? null)}</Table.Cell>
                      <Table.Cell>
                        {item.article?.vat_rate ? (
                          <Badge color={item.article.vat_rate.color} variant="muted">
                            {item.article.vat_rate.label}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </Table.Cell>
                      <Table.Cell>{Number(item.discount_percent) > 0 ? `${Number(item.discount_percent)}%` : "—"}</Table.Cell>
                      <Table.Cell>{formatCurrency(inclDiscount)}</Table.Cell>
                      <Table.Cell>{formatCurrency(rowTotalValue)}</Table.Cell>
                      {showActionsColumn && (
                        <Table.Cell align="center">
                          {canDelete && (
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeletingItem(item);
                              }}
                              disabled={draft !== null}
                            >
                              Delete
                            </Button>
                          )}
                        </Table.Cell>
                      )}
                    </Table.Row>
                  );
                })}
                {newRowDraft && renderDraftRow("new-row-draft", null)}
              </Table.Body>
            </Table>

            <SummaryRow
              items={[
                { label: "Subtotal", value: formatCurrency(subtotal) },
                { label: "VAT", value: formatCurrency(vatAmount) },
                { label: "Total", value: formatCurrency(total), emphasis: "bold" },
              ]}
            />

            {canCreate && (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={startAdd} disabled={draft !== null}>
                  Add line item
                </Button>
              </div>
            )}
          </>
        )}
      </Stack>

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
