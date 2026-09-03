import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

/**
 * The invoice PDF layout itself (issue #119) — a plain `@react-pdf/renderer`
 * document, deliberately kept in its own file (not inlined into
 * `invoice-actions.ts`) so the rendering/layout concern is separate from the
 * Server Action's data-fetching/Storage/DB concern, mirroring this repo's
 * general "actions file vs. presentation file" split. This file exports plain
 * (synchronous) React components, NOT `"use server"` — it is imported by
 * `invoice-actions.ts` and rendered there via `renderToBuffer()`.
 *
 * Layout reference: `docs/invoice/Invoiceexample.pdf` (reviewed before
 * writing this). Copy is in Dutch (`VAN`/`FACTUUR AAN`/`FACTUURDATUM`/etc.),
 * matching that reference's own audience-facing phrasing, per the issue
 * hand-off's explicit "use your judgment" on English vs. Dutch here.
 *
 * Deliberately does NOT render a "werkordernummer" the way the reference PDF
 * does — there is no human-facing Work Order display number anywhere in this
 * schema (only Assets have one). When `workOrderReference` is provided (the
 * linked work order's own `title`, fetched by `invoice-actions.ts`), it's
 * shown under a plain "WERKORDER" label instead of implying a formatted
 * number; the meta row is simply omitted when there is no linked work order.
 *
 * Pagination: `Page`'s default `wrap` behavior automatically flows content
 * (including the line-items table) onto additional pages when it overflows
 * — no manual pagination needed. Each line-item row is `wrap={false}` so a
 * single row is never split across a page boundary (it moves to the next
 * page whole instead). The table header (`LineItemsHeader`) is a `fixed`
 * `View`, which `@react-pdf/renderer` re-renders at the same position on
 * every page the flowing content spans — the standard repeating-table-header
 * pattern for this library.
 */

export interface InvoicePdfAddress {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export interface InvoicePdfLineItem {
  articleNumber: string | null;
  description: string;
  /** The line's linked asset's serial number and/or model name, pre-joined
   * server-side into one display string (e.g. `"SN-1234 / Acme X200"`, or
   * just one half when only one of the two is set) — `null` when the line
   * has no linked asset (`quote_line_items.asset_id` is `null`), same
   * "no data to invent from" convention as `articleNumber`/`vatPercent`
   * below. Mirrors what `quote-line-items-panel.tsx`'s Asset column already
   * resolves `asset_id` against (its `clientAssets` list), just showing the
   * asset's serial number/model instead of its name — this PDF has no room
   * for a clickable link, so a plain string is enough here. */
  assetLabel: string | null;
  /** The line's assigned engineer's display name, resolved server-side the
   * same way `quote-line-items-panel.tsx`/`memberDisplayName` resolve
   * `engineer_user_id` against this org's members — `null` when the line has
   * no assigned engineer. */
  engineerName: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  /** As a plain percentage number (e.g. `21`), resolved server-side the same
   * way `quote-line-items-panel.tsx`'s `lineVatPercent` does — `0` for a line
   * with no linked article. */
  vatPercent: number;
  /** Pre-VAT line total: `quantity * unitPrice * (1 - discountPercent/100)`. */
  lineTotal: number;
}

export interface InvoicePdfVatBreakdownEntry {
  vatPercent: number;
  amount: number;
}

export interface InvoicePdfProps {
  invoiceNumber: string;
  /** Pre-formatted (Dutch long date, e.g. "2 september 2026") — formatted by
   * the caller so this component stays pure layout, no `Intl` calls here. */
  invoiceDateLabel: string;
  dueDateLabel: string;
  /** The quote's own `name`, shown as "REFERENTIE". */
  reference: string;
  /** The linked work order's `title`, when the quote has one (`work_order_id`
   * set) — `null`/omitted otherwise. See the module comment above for why
   * this is plain title text, not a formatted work-order number. */
  workOrderReference: string | null;
  sender: {
    name: string;
    kvkNumber: string | null;
    vatNumber: string | null;
    address: InvoicePdfAddress | null;
    logoUrl: string | null;
  };
  recipient: {
    name: string;
    vatNumber: string | null;
    address: InvoicePdfAddress | null;
  };
  lineItems: InvoicePdfLineItem[];
  subtotal: number;
  vatBreakdown: InvoicePdfVatBreakdownEntry[];
  vatTotal: number;
  total: number;
  /** Tenant's own IBAN, shown in the footer. `null` renders a blank instead
   * of a broken payment instruction — `generateInvoice` in `invoice-actions.ts`
   * doesn't hard-require this, only `ownClient` presence itself, so a tenant
   * that hasn't filled in an IBAN yet can still generate an invoice. */
  iban: string | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  logo: {
    width: 120,
    maxHeight: 60,
    objectFit: "contain",
  },
  brandFallback: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
  },
  headerRight: {
    alignItems: "flex-end",
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
  },
  invoiceNumber: {
    fontSize: 10,
    color: "#555555",
    marginTop: 2,
  },
  partiesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  partyColumn: {
    width: "48%",
  },
  label: {
    fontSize: 7,
    color: "#8a8a8a",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  partyName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  partyLine: {
    fontSize: 9,
    color: "#333333",
    marginBottom: 1,
  },
  metaRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#dddddd",
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
    paddingVertical: 10,
    marginBottom: 20,
  },
  metaItem: {
    marginRight: 32,
  },
  metaValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f4f4f4",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eeeeee",
  },
  // Nine columns total (Artikelnr, Artikel, Serienr./Model, Engineer, Aantal,
  // Stukprijs, Korting, Btw, Totaal), matching the reference PDF's column
  // order (`docs/invoice/Invoiceexample.pdf`) — widths re-proportioned from
  // the original 7-column layout to fit the two new columns while keeping
  // Artikel (description) the widest column, since it's the only
  // unbounded-length field. Every column but the last carries its own
  // `paddingRight` gutter — with 9 columns this tight, a header/cell whose
  // text nearly fills its column width would otherwise butt directly up
  // against the next column's text with zero visual gap (confirmed via a
  // rendered-fixture text-extraction check on the SERIENR./MODEL + ENGINEER
  // header pair before this was added); the last column needs none since
  // there's no further column after it.
  colArticleNumber: { width: "10%", paddingRight: 4 },
  colDescription: { width: "20%", paddingRight: 4 },
  colAsset: { width: "14%", paddingRight: 4 },
  colEngineer: { width: "12%", paddingRight: 4 },
  colQuantity: { width: "6%", textAlign: "right", paddingRight: 4 },
  colUnitPrice: { width: "12%", textAlign: "right", paddingRight: 4 },
  colDiscount: { width: "8%", textAlign: "right", paddingRight: 4 },
  colVat: { width: "6%", textAlign: "right", paddingRight: 4 },
  colTotal: { width: "12%", textAlign: "right" },
  tableHeaderText: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#666666",
    letterSpacing: 0.5,
  },
  cellText: {
    fontSize: 9,
  },
  cellTextBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  totalsBlock: {
    marginTop: 16,
    alignSelf: "flex-end",
    width: "45%",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalsRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
  },
  totalsLabel: {
    fontSize: 9,
    color: "#444444",
  },
  totalsValue: {
    fontSize: 9,
  },
  totalsLabelFinal: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  totalsValueFinal: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#dddddd",
    paddingTop: 8,
  },
  footerNoteBlock: {
    marginBottom: 12,
  },
  footerNoteLabel: {
    fontSize: 7,
    color: "#8a8a8a",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  footerNoteText: {
    fontSize: 8,
    color: "#444444",
    lineHeight: 1.4,
  },
  footerTagline: {
    fontSize: 7,
    color: "#999999",
  },
});

const currencyFormatter = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function AddressLines({ address }: { address: InvoicePdfAddress | null }) {
  if (!address) return null;
  const line1 = [address.line1, address.line2].filter(Boolean).join(", ");
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(" ");
  return (
    <>
      {line1 ? <Text style={styles.partyLine}>{line1}</Text> : null}
      {cityLine ? <Text style={styles.partyLine}>{cityLine}</Text> : null}
      {address.country ? <Text style={styles.partyLine}>{address.country}</Text> : null}
    </>
  );
}

function LineItemsHeader() {
  return (
    <View style={styles.tableHeaderRow} fixed>
      <Text style={[styles.tableHeaderText, styles.colArticleNumber]}>ARTIKELNR.</Text>
      <Text style={[styles.tableHeaderText, styles.colDescription]}>ARTIKEL</Text>
      <Text style={[styles.tableHeaderText, styles.colAsset]}>SERIENR. / MODEL</Text>
      <Text style={[styles.tableHeaderText, styles.colEngineer]}>ENGINEER</Text>
      <Text style={[styles.tableHeaderText, styles.colQuantity]}>AANTAL</Text>
      <Text style={[styles.tableHeaderText, styles.colUnitPrice]}>STUKPRIJS</Text>
      <Text style={[styles.tableHeaderText, styles.colDiscount]}>KORTING</Text>
      <Text style={[styles.tableHeaderText, styles.colVat]}>BTW</Text>
      <Text style={[styles.tableHeaderText, styles.colTotal]}>TOTAAL</Text>
    </View>
  );
}

export function InvoiceDocument(props: InvoicePdfProps) {
  const { sender, recipient } = props;

  return (
    <Document title={`Factuur ${props.invoiceNumber}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerRow}>
          {sender.logoUrl ? (
            // @react-pdf/renderer's Image accepts a remote URL directly and
            // fetches it internally — no need to pre-fetch/embed bytes here.
            // Not an HTML <img> (this is a PDF-only, non-DOM component from
            // @react-pdf/renderer's own reconciler), so jsx-a11y's alt-text
            // rule doesn't apply here.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={sender.logoUrl} style={styles.logo} />
          ) : (
            <Text style={styles.brandFallback}>{sender.name}</Text>
          )}
          <View style={styles.headerRight}>
            <Text style={styles.title}>Factuur</Text>
            <Text style={styles.invoiceNumber}>{props.invoiceNumber}</Text>
          </View>
        </View>

        <View style={styles.partiesRow}>
          <View style={styles.partyColumn}>
            <Text style={styles.label}>VAN</Text>
            <Text style={styles.partyName}>{sender.name}</Text>
            <AddressLines address={sender.address} />
            {sender.kvkNumber ? <Text style={styles.partyLine}>KvK {sender.kvkNumber}</Text> : null}
            {sender.vatNumber ? <Text style={styles.partyLine}>BTW {sender.vatNumber}</Text> : null}
          </View>
          <View style={styles.partyColumn}>
            <Text style={styles.label}>FACTUUR AAN</Text>
            <Text style={styles.partyName}>{recipient.name}</Text>
            <AddressLines address={recipient.address} />
            {recipient.vatNumber ? <Text style={styles.partyLine}>BTW {recipient.vatNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.label}>FACTUURDATUM</Text>
            <Text style={styles.metaValue}>{props.invoiceDateLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.label}>VERVALDATUM</Text>
            <Text style={styles.metaValue}>{props.dueDateLabel}</Text>
          </View>
          {props.workOrderReference ? (
            <View style={styles.metaItem}>
              <Text style={styles.label}>WERKORDER</Text>
              <Text style={styles.metaValue}>{props.workOrderReference}</Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Text style={styles.label}>REFERENTIE</Text>
            <Text style={styles.metaValue}>{props.reference}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Regels</Text>

        <LineItemsHeader />
        {props.lineItems.map((item, index) => (
          // wrap={false}: a single row never splits across a page break —
          // it moves to the next page whole instead (see module comment).
          <View key={index} style={styles.tableRow} wrap={false}>
            <Text style={[styles.cellText, styles.colArticleNumber]}>{item.articleNumber ?? "—"}</Text>
            <Text style={[styles.cellText, styles.colDescription]}>{item.description}</Text>
            <Text style={[styles.cellText, styles.colAsset]}>{item.assetLabel ?? "—"}</Text>
            <Text style={[styles.cellText, styles.colEngineer]}>{item.engineerName ?? "—"}</Text>
            <Text style={[styles.cellText, styles.colQuantity]}>{item.quantity}</Text>
            <Text style={[styles.cellText, styles.colUnitPrice]}>{formatCurrency(item.unitPrice)}</Text>
            <Text style={[styles.cellText, styles.colDiscount]}>
              {item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}
            </Text>
            <Text style={[styles.cellText, styles.colVat]}>{item.vatPercent}%</Text>
            <Text style={[styles.cellTextBold, styles.colTotal]}>{formatCurrency(item.lineTotal)}</Text>
          </View>
        ))}

        <View style={styles.totalsBlock} wrap={false}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotaal excl. btw</Text>
            <Text style={styles.totalsValue}>{formatCurrency(props.subtotal)}</Text>
          </View>
          {props.vatBreakdown.map((entry) => (
            <View key={entry.vatPercent} style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Btw {entry.vatPercent}%</Text>
              <Text style={styles.totalsValue}>{formatCurrency(entry.amount)}</Text>
            </View>
          ))}
          <View style={styles.totalsRowFinal}>
            <Text style={styles.totalsLabelFinal}>Totaal te betalen</Text>
            <Text style={styles.totalsValueFinal}>{formatCurrency(props.total)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerNoteBlock}>
            <Text style={styles.footerNoteLabel}>BETALING</Text>
            <Text style={styles.footerNoteText}>
              Gelieve het totaalbedrag binnen 30 dagen te voldoen
              {props.iban ? ` op IBAN ${props.iban}` : ""} t.n.v. {sender.name}, onder vermelding van
              factuurnummer {props.invoiceNumber}
              {props.workOrderReference ? ` en werkorder ${props.workOrderReference}` : ""}.
            </Text>
          </View>
          <Text style={styles.footerTagline}>
            {sender.name}
            {sender.kvkNumber ? ` · KvK ${sender.kvkNumber}` : ""}
            {sender.vatNumber ? ` · BTW ${sender.vatNumber}` : ""}
            {props.iban ? ` · IBAN ${props.iban}` : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
