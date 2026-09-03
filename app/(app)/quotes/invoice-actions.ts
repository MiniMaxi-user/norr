"use server";

import { createElement, type ReactElement } from "react";
import { z } from "zod";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { memberDisplayName } from "@/lib/members/format";
import { getOrganizationCompanySettings } from "../settings/company-actions";
import { InvoiceDocument, type InvoicePdfAddress, type InvoicePdfLineItem, type InvoicePdfVatBreakdownEntry } from "./invoice-pdf";

/**
 * Server Actions for Invoicing (issue #119, "Als owner / administratie /
 * platform admin wil ik een factuur kunnen maken") — generate/view/delete a
 * PDF invoice from a Quote. Same four-step preamble as every other module's
 * actions (see `app/(app)/clients/actions.ts`'s header comment): resolve
 * module context (`hasFeature("invoicing")` + RBAC actor) -> `can()` ->
 * Zod validation -> query under the caller's own session (RLS is always the
 * real backstop). Modeled most closely on `../clients/logo-actions.ts`
 * (generate/store a derived artifact in Storage, keep a small pointer row,
 * allow delete) — adapted for a financial PDF instead of an image:
 *
 *  - `invoices` has NO update policy/grant at all (migration
 *    `20260903100000_invoices_core.sql`, design note 2) — regenerating an
 *    invoice is DELETE the existing row (if any) + its Storage object, then
 *    INSERT a fresh one, never an UPDATE. `generateInvoice` below implements
 *    exactly that "replace" dance.
 *  - RLS/RBAC boundary is owner/administratie ONLY (`lib/rbac/permissions.ts`'s
 *    `invoicing` module) — deliberately narrower than, and role-different
 *    from, `quotes`' own owner+planner boundary. A Platform Admin needs no
 *    special-casing here: they qualify purely by being `owner` of their own
 *    org (confirmed scope decision, see the migration's header).
 *  - The `invoices` Storage bucket is PRIVATE — every "view the PDF" flow
 *    goes through a short-lived signed URL minted server-side
 *    (`getInvoiceSignedUrl`), never a public URL. No service-role client
 *    anywhere in this file: every Supabase call runs under the caller's own
 *    session (`lib/supabase/server.ts`), same as every other action in this
 *    repo, since `invoices`' RLS + the Storage bucket's own RLS already do
 *    the real enforcement.
 *
 * PDF layout itself lives in `./invoice-pdf.tsx` (`InvoiceDocument`) —
 * kept separate from this data-fetching/orchestration file. Rendered via
 * `@react-pdf/renderer`'s `renderToBuffer()`, which runs in plain Node.js
 * (no headless browser), so this file is a normal Server Action module.
 * `createElement` (not JSX) is used to build the document element, since this
 * is a `.ts` file, not `.tsx`.
 */

const uuidSchema = z.string().uuid("Invalid id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ---------------------------------------------------------------------------
// Shared: resolving a client's own postal address for the PDF, and computing
// the money figures from a quote's line items. Both are used only by
// `generateInvoice` below, but pulled out as standalone functions to keep
// that function's own body readable.
// ---------------------------------------------------------------------------

interface SiteAddressRow {
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  is_invoice_address: boolean;
  is_primary: boolean;
}

/**
 * Picks the "best" address to show for a client on the invoice: its
 * `is_invoice_address` site if it has one (the acceptance criterion's own
 * "FACTUUR AAN" requirement), falling back to its `is_primary` site, then
 * simply the first site (alphabetical by address, matching `getClient`'s own
 * site ordering in `../clients/actions.ts`) — rather than rendering no
 * address at all just because a client hasn't explicitly flagged one of its
 * sites as the invoice address. Used for BOTH the recipient (the quote's own
 * client) and the sender (the tenant's own `ownClient`) — there is no
 * separate concept of "the organization's own address" anywhere in this
 * schema, only Sites belonging to its own Client row (`organizations.
 * own_client_id`), so the same resolution applies to both. Returns `null`
 * when the client has no sites at all (renders no address block, not a
 * broken one).
 */
async function resolveClientAddress(
  supabase: SupabaseServerClient,
  clientId: string,
): Promise<InvoicePdfAddress | null> {
  const { data, error } = await supabase
    .from("sites")
    .select("address_line1,address_line2,postal_code,city,country,is_invoice_address,is_primary")
    .eq("client_id", clientId)
    .order("address_line1", { ascending: true });

  if (error || !data || data.length === 0) return null;

  const rows = data as SiteAddressRow[];
  const firstRow = rows[0];
  if (!firstRow) return null; // unreachable given the length check above; satisfies strict indexing
  const chosen = rows.find((s) => s.is_invoice_address) ?? rows.find((s) => s.is_primary) ?? firstRow;

  return {
    line1: chosen.address_line1,
    line2: chosen.address_line2,
    postalCode: chosen.postal_code,
    city: chosen.city,
    country: chosen.country,
  };
}

interface InvoiceQuoteLineItemRow {
  description: string;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  asset_id: string | null;
  engineer_user_id: string | null;
  article: {
    article_number: string;
    vat_rate: { value: string | number } | null;
  } | null;
}

interface InvoiceAssetLabelRow {
  id: string;
  serial_number: string | null;
  asset_model: { name: string } | null;
}

/** Combines an asset's serial number and model name into the single display
 * string the reference PDF's "SERIENR. / MODEL" column expects — mirrors
 * `quote-line-items-panel.tsx`'s own "degrade gracefully" convention for an
 * optional field (only one half missing still renders the other; both
 * missing renders nothing at all, resolved to `null` here so the PDF's own
 * `?? "—"` fallback applies exactly like every other optional column). */
function formatAssetLabel(asset: Pick<InvoiceAssetLabelRow, "serial_number" | "asset_model"> | undefined): string | null {
  if (!asset) return null;
  const parts = [asset.serial_number, asset.asset_model?.name].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : null;
}

interface ComputedLineItems {
  lineItems: InvoicePdfLineItem[];
  subtotal: number;
  vatBreakdown: InvoicePdfVatBreakdownEntry[];
  vatTotal: number;
  total: number;
}

/**
 * Replicates `quote-line-items-panel.tsx`'s exact math server-side (per that
 * file's own doc comment, referenced by this feature's hand-off): a line's
 * pre-VAT total is `quantity * unitPrice * (1 - discountPercent / 100)`, its
 * VAT rate is `0` when it has no linked article (`lineVatPercent`'s own
 * reasoning — there is no VAT-rate column on `quote_line_items` itself), and
 * VAT is computed PER LINE then summed — so mixed VAT rates on one quote are
 * handled correctly (each line contributes to its own rate's bucket in
 * `vatBreakdown`, sorted highest-first, matching the reference PDF's single-
 * rate "Btw 21%" line as the one-rate special case of the same general
 * mechanism). Rounds each displayed money figure independently to 2 decimal
 * places (money precision) only at the end, not per intermediate step, same
 * "avoid floating-point summation artifacts" reasoning as `computeTotal` in
 * `../quotes/actions.ts`.
 */
function computeInvoiceLineItems(
  rows: readonly InvoiceQuoteLineItemRow[],
  assetLabelById: ReadonlyMap<string, string | null>,
  engineerNameById: ReadonlyMap<string, string>,
): ComputedLineItems {
  const vatBuckets = new Map<number, number>();
  let subtotalRaw = 0;

  const lineItems: InvoicePdfLineItem[] = rows.map((row) => {
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unit_price);
    const discountPercent = Number(row.discount_percent);
    const vatPercent = row.article?.vat_rate?.value ? Number(row.article.vat_rate.value) : 0;

    const lineTotal = quantity * unitPrice * (1 - discountPercent / 100);
    subtotalRaw += lineTotal;
    vatBuckets.set(vatPercent, (vatBuckets.get(vatPercent) ?? 0) + lineTotal * (vatPercent / 100));

    return {
      articleNumber: row.article?.article_number ?? null,
      description: row.description,
      // `?? null` twice over here on purpose: no asset/engineer linked at
      // all (id is `null`) and "linked but its label/name couldn't be
      // resolved" (id present but missing from the map — shouldn't happen,
      // same defensive-only reasoning as `quote-line-items-panel.tsx`'s own
      // "Unknown asset" fallback) both degrade to the same blank cell.
      assetLabel: row.asset_id ? (assetLabelById.get(row.asset_id) ?? null) : null,
      engineerName: row.engineer_user_id ? (engineerNameById.get(row.engineer_user_id) ?? null) : null,
      quantity,
      unitPrice,
      discountPercent,
      vatPercent,
      lineTotal: Math.round(lineTotal * 100) / 100,
    };
  });

  const vatBreakdown: InvoicePdfVatBreakdownEntry[] = Array.from(vatBuckets.entries())
    .sort(([a], [b]) => b - a)
    .map(([vatPercent, amount]) => ({ vatPercent, amount: Math.round(amount * 100) / 100 }));

  const subtotal = Math.round(subtotalRaw * 100) / 100;
  const vatTotal = Math.round(vatBreakdown.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;

  return { lineItems, subtotal, vatBreakdown, vatTotal, total: Math.round((subtotal + vatTotal) * 100) / 100 };
}

const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ---------------------------------------------------------------------------
// generateInvoice
// ---------------------------------------------------------------------------

export interface GenerateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  signedUrl: string;
}

const SIGNED_URL_TTL_SECONDS = 120;

/**
 * Generates (or regenerates) a PDF invoice for `quoteId`. Regeneration is
 * DELETE-the-existing-row-and-object THEN INSERT-a-fresh-one (see the module
 * comment above) — `invoices.quote_id` is `unique`, so a stale row would
 * otherwise make the fresh INSERT fail with a `23505` unique-violation.
 */
export async function generateInvoice(quoteId: string): Promise<ActionResult<GenerateInvoiceResult>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner or administratie member can generate invoices.");
  }

  const supabase = await createSupabaseServerClient();

  // 1. Load the quote (RLS-scoped to the caller's org) with its client, and
  // — if the quote already has a linked work order (issue #94) — that work
  // order's own `title`, used only as an identifying text on the PDF's meta
  // row (see ./invoice-pdf.tsx's own doc comment on why this is NOT a
  // "werkordernummer"). `!fkey` disambiguators throughout, matching this
  // module's existing embed convention (`../quotes/actions.ts`'s
  // `QUOTE_SELECT`/`QUOTE_LINE_ITEM_SELECT`).
  const { data: quoteRow, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, client_id, site_id, name, work_order_id," +
        " client:clients!quotes_client_id_fkey(id,name,vat_number)," +
        " work_order:work_orders!quotes_work_order_id_fkey(id,title)",
    )
    .eq("id", idResult.data)
    .maybeSingle<{
      id: string;
      client_id: string;
      site_id: string | null;
      name: string;
      work_order_id: string | null;
      client: { id: string; name: string; vat_number: string | null } | null;
      work_order: { id: string; title: string } | null;
    }>();

  if (quoteError) return fail(mapDbError(quoteError));
  if (!quoteRow) return fail("Quote not found, or you do not have permission to view it.");
  if (!quoteRow.client) {
    // Defensive only — `client_id` is `not null` and FK-enforced, so this
    // should be unreachable, but a null client would otherwise crash the PDF
    // render below rather than fail cleanly.
    return fail("This quote's client could not be found.");
  }

  // 2. Load the quote's line items with their linked article's number + VAT
  // rate (same embed shape as `../quotes/actions.ts`'s `QUOTE_LINE_ITEM_SELECT`,
  // trimmed to just the columns the PDF needs), ordered the same way
  // `listQuoteLineItems` orders them. Also pulls the raw `asset_id`/
  // `engineer_user_id` uuids — deliberately NOT joined here (no FK embed for
  // either column, same as `quote-line-items-panel.tsx`'s own resolution):
  // resolved below via two small, targeted-by-id lookups instead, mirroring
  // that panel's own "raw uuid, resolve against a small directory" pattern
  // for both columns.
  const { data: lineItemRows, error: lineItemsError } = await supabase
    .from("quote_line_items")
    .select(
      "description, quantity, unit_price, discount_percent, asset_id, engineer_user_id," +
        " article:articles!quote_line_items_article_id_fkey(article_number, vat_rate:reference_list_items!articles_vat_rate_item_id_fkey(value))",
    )
    .eq("quote_id", idResult.data)
    .order("sort_order", { ascending: true });

  if (lineItemsError) return fail(mapDbError(lineItemsError));

  const lineItemRowsTyped = (lineItemRows ?? []) as unknown as InvoiceQuoteLineItemRow[];

  // 2b. Resolve the small set of distinct assets/engineers actually
  // referenced by this quote's line items — targeted `.in()` lookups rather
  // than reusing `listOrgMembers()` (gated on the `planning` feature, a
  // module `invoicing` has no dependency on) or an org-wide asset list, so
  // this works even for a tenant that never enabled Planning. Both tables'
  // own RLS (`users_select_self_or_org_peers`, `assets`' own org-scoped
  // policy) already restrict either lookup to this caller's own org, same
  // "RLS is the real backstop" posture as every other query in this file.
  const assetIds = Array.from(new Set(lineItemRowsTyped.map((row) => row.asset_id).filter((id): id is string => Boolean(id))));
  const engineerIds = Array.from(
    new Set(lineItemRowsTyped.map((row) => row.engineer_user_id).filter((id): id is string => Boolean(id))),
  );

  // `.in("id", [])` returns an empty result set (not an error) in
  // PostgREST/supabase-js, so these run unconditionally rather than branching
  // on `assetIds.length`/`engineerIds.length` — keeps both query shapes
  // uniform for `Promise.all` instead of a ternary-per-branch union type.
  const [assetLabelRows, engineerRows] = await Promise.all([
    supabase
      .from("assets")
      .select("id, serial_number, asset_model:asset_models!assets_model_id_fkey(name)")
      .in("id", assetIds),
    supabase.from("users").select("id, email, full_name").in("id", engineerIds),
  ]);

  if (assetLabelRows.error) return fail(mapDbError(assetLabelRows.error));
  if (engineerRows.error) return fail(mapDbError(engineerRows.error));

  const assetLabelById = new Map<string, string | null>(
    (assetLabelRows.data as unknown as InvoiceAssetLabelRow[]).map((asset) => [asset.id, formatAssetLabel(asset)]),
  );
  const engineerNameById = new Map<string, string>(
    (engineerRows.data ?? []).map((member) => [member.id, memberDisplayName(member)]),
  );

  // 3. The tenant's own company data (issue #120) — required for the "VAN"
  // block. Fails clean rather than generating a PDF with a blank sender.
  const companySettings = await getOrganizationCompanySettings();
  if (!companySettings.data) return fail(companySettings.error ?? "Could not load organization settings.");
  const ownClient = companySettings.data.ownClient;
  if (!ownClient) {
    return fail(
      "Configure your own company details in Settings → Company before generating an invoice.",
    );
  }

  const [senderAddress, recipientAddress] = await Promise.all([
    resolveClientAddress(supabase, ownClient.id),
    resolveClientAddress(supabase, quoteRow.client_id),
  ]);

  const computed = computeInvoiceLineItems(lineItemRowsTyped, assetLabelById, engineerNameById);

  // 4. Regenerate = delete the existing invoice (row + Storage object) first,
  // since `invoices` has no UPDATE grant/policy at all and `quote_id` is
  // `unique` (see the module comment above).
  const { data: existingInvoice, error: existingError } = await supabase
    .from("invoices")
    .select("id, pdf_path")
    .eq("quote_id", idResult.data)
    .maybeSingle<{ id: string; pdf_path: string }>();
  if (existingError) return fail(mapDbError(existingError));

  if (existingInvoice) {
    const { error: deleteRowError } = await supabase.from("invoices").delete().eq("id", existingInvoice.id);
    if (deleteRowError) return fail(mapDbError(deleteRowError));
    await supabase.storage.from("invoices").remove([existingInvoice.pdf_path]);
  }

  // 5. Mint the sequential invoice number (race-safe per-org counter,
  // `next_invoice_number()` re-checks owner/administratie itself server-side
  // — see the migration's design note 4).
  const { data: invoiceNumber, error: numberError } = await supabase.rpc("next_invoice_number", {
    p_organization_id: organizationId,
  });
  if (numberError) return fail(mapDbError(numberError));
  if (!invoiceNumber) return fail("Could not generate an invoice number.");

  // 6. Render the PDF.
  const invoiceDate = new Date();
  const dueDate = addDays(invoiceDate, 30);

  const pdfElement = createElement(InvoiceDocument, {
    invoiceNumber,
    invoiceDateLabel: dateFormatter.format(invoiceDate),
    dueDateLabel: dateFormatter.format(dueDate),
    reference: quoteRow.name,
    workOrderReference: quoteRow.work_order?.title ?? null,
    sender: {
      name: ownClient.name,
      kvkNumber: ownClient.kvkNumber,
      vatNumber: ownClient.vatNumber,
      address: senderAddress,
      logoUrl: ownClient.logoUrl,
    },
    recipient: {
      name: quoteRow.client.name,
      vatNumber: quoteRow.client.vat_number,
      address: recipientAddress,
    },
    lineItems: computed.lineItems,
    subtotal: computed.subtotal,
    vatBreakdown: computed.vatBreakdown,
    vatTotal: computed.vatTotal,
    total: computed.total,
    iban: ownClient.iban,
  }) as unknown as ReactElement<DocumentProps>;

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderToBuffer(pdfElement);
  } catch {
    return fail("Could not render the invoice PDF.");
  }

  // 7. Upload to the private "invoices" bucket at the fixed path convention
  // (migration design note 5), then insert the pointer row.
  const pdfPath = `${organizationId}/${idResult.data}/invoice.pdf`;
  const { error: uploadError } = await supabase.storage.from("invoices").upload(pdfPath, pdfBuffer, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (uploadError) return fail(uploadError.message);

  const { data: insertedInvoice, error: insertError } = await supabase
    .from("invoices")
    .insert({ quote_id: idResult.data, invoice_number: invoiceNumber, pdf_path: pdfPath })
    .select("id")
    .single<{ id: string }>();

  if (insertError) {
    // Best-effort cleanup of the just-uploaded object so a failed INSERT
    // doesn't leave an orphaned PDF with no pointer row.
    await supabase.storage.from("invoices").remove([pdfPath]);
    return fail(mapDbError(insertError));
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("invoices")
    .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return fail(signedUrlError?.message ?? "Invoice was generated, but the preview link could not be created.");
  }

  return ok({ invoiceId: insertedInvoice.id, invoiceNumber, signedUrl: signedUrlData.signedUrl });
}

// ---------------------------------------------------------------------------
// getInvoiceForQuote / getInvoiceSignedUrl / deleteInvoice
// ---------------------------------------------------------------------------

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  generatedAt: string;
}

/** Whether `quoteId` already has an invoice — drives the Quote detail page's
 * "Generate" vs. "View" / "Regenerate" button state. */
export async function getInvoiceForQuote(
  quoteId: string,
): Promise<ActionResult<{ invoice: InvoiceSummary | null }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "invoicing", "read")) {
    return fail("You do not have permission to view invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, generated_at")
    .eq("quote_id", idResult.data)
    .maybeSingle<{ id: string; invoice_number: string; generated_at: string }>();

  if (error) return fail(mapDbError(error));
  if (!data) return ok({ invoice: null });

  return ok({ invoice: { id: data.id, invoiceNumber: data.invoice_number, generatedAt: data.generated_at } });
}

/** Mints a fresh short-lived signed URL for an existing invoice — called each
 * time the frontend opens the "view PDF" popup, rather than reusing a
 * possibly-expired URL from generation time. */
export async function getInvoiceSignedUrl(invoiceId: string): Promise<ActionResult<{ signedUrl: string }>> {
  const idResult = uuidSchema.safeParse(invoiceId);
  if (!idResult.success) return fail("Invalid invoice id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "invoicing", "read")) {
    return fail("You do not have permission to view invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("pdf_path")
    .eq("id", idResult.data)
    .maybeSingle<{ pdf_path: string }>();

  if (error) return fail(mapDbError(error));
  if (!invoice) return fail("Invoice not found, or you do not have permission to view it.");

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("invoices")
    .createSignedUrl(invoice.pdf_path, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData) {
    return fail(signedUrlError?.message ?? "Could not create a preview link for this invoice.");
  }

  return ok({ signedUrl: signedUrlData.signedUrl });
}

/** Deletes an invoice: removes the DB row, then its Storage object. Either
 * order is safe (neither row is the other's FK parent) — DB row first so a
 * caller who somehow lacks Storage delete rights (shouldn't happen, both
 * RLS boundaries match) still loses the pointer row rather than being left
 * with a dangling reference to a removed file. */
export async function deleteInvoice(invoiceId: string): Promise<ActionResult<{ success: true }>> {
  const idResult = uuidSchema.safeParse(invoiceId);
  if (!idResult.success) return fail("Invalid invoice id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "invoicing", "delete")) {
    return fail("Only an owner or administratie member can delete invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: invoice, error: lookupError } = await supabase
    .from("invoices")
    .select("pdf_path")
    .eq("id", idResult.data)
    .maybeSingle<{ pdf_path: string }>();

  if (lookupError) return fail(mapDbError(lookupError));
  if (!invoice) return fail("Invoice not found, or you do not have permission to delete it.");

  const { error: deleteError } = await supabase.from("invoices").delete().eq("id", idResult.data);
  if (deleteError) return fail(mapDbError(deleteError));

  await supabase.storage.from("invoices").remove([invoice.pdf_path]);

  return ok({ success: true });
}
