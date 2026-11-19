"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { SidebarSection, WebDetailLayout, WebPage, type WebBadgeVariant } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  PageHeader,
  scrollMainToTop,
  toneFromColor,
  useEditMode,
  webTabIds,
  type PageHeaderBadge,
  type PageHeaderTab,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { workOrderLabel } from "@/lib/format/work-order-label";
import { setLastUsedView } from "@/lib/preferences/actions";
import type { QuoteLineItemRecord, QuoteRecord } from "../actions";
import type { InvoiceSummary } from "../invoice-actions";
import { QUOTE_DETAIL_VIEW_KEY } from "./constants";
import { draftFromQuote, emptyDraft, type QuoteDraft } from "./quote-draft";
import { buildQuoteSchema, createQuoteFromDraft, saveQuoteEdits } from "./quote-form-schema";
import { getLivePanel } from "./quote-live-panel";
import { QuoteDocumentsPanel } from "./quote-documents-panel";
import { QuoteOverviewCards } from "./quote-overview-cards";
import { QuoteRail } from "./quote-rail";
import { buildQuoteTimeline } from "./quote-timeline";
import { QuoteLineItemsPanel } from "./quote-line-items-panel";
import { todayAmsterdam, validityDaysLeft as getValidityDaysLeft } from "./quote-status";
import { quoteTotals } from "./quote-totals";
import { useQuoteInvoice } from "./use-quote-invoice";
import { DeleteQuoteDialog } from "./delete-quote-dialog";

export type QuoteDetailTab = "overview" | "lineItems" | "documents";

export interface QuoteScreenProps {
  mode: "create" | "edit";

  /** Required for `mode: "edit"`. */
  quote?: QuoteRecord;
  /** The quote's client (edit) or the locked client (create). */
  client?: ClientRecord | null;
  /** Clients to choose from. */
  clients?: ClientRecord[];
  /** This org's `quote_status` reference list. */
  statuses?: ReferenceListItemRecord[];
  lockedClientId?: string;
  cancelHref?: string;

  // ---- edit-mode-only ----
  /** `can(actor, "quotes", ...)`. Never render an edit affordance RLS would reject. */
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  lineItems?: QuoteLineItemRecord[];
  clientAssets?: AssetRecord[];
  articles?: ArticleSelectOption[];
  members?: OrgMemberRecord[];
  /** The work order this quote was made from (issue #109), if any. */
  sourceWorkOrder?: WorkOrderRecord | null;
  /** The contract a contract quote was generated for (issue #210), if any. */
  contract?: ContractRecord | null;
  /** `null` = no invoice yet, or the viewer cannot read invoices. */
  invoice?: InvoiceSummary | null;
  /** `can(actor, "invoicing", "create")` folded with the feature flag. */
  canInvoice?: boolean;
  defaultTab?: QuoteDetailTab;
}

/**
 * The single shared screen behind `/quotes/new` (`mode: "create"`) and
 * `/quotes/[id]` (`mode: "edit"`) on the web design system (issue #222),
 * built exactly like the Contract page:
 *
 *  - `PageHeader`: breadcrumb (`Quotes / number`, mono), title (the quote's name),
 *    badges (status → expired → contract → auto-draft), ONE Edit button
 *    (Overview only, omitted without update permission), the ··· menu (invoice
 *    PDF, resend, Delete) and tabs with counts. No navy primary: the one
 *    invoicing action ("Generate invoice", which sets the quote to
 *    Invoiced) lives in the LivePanel;
 *  - centre: the active tab — Overview (ONE two-column Details card + Notes;
 *    no related-list previews) or Line items (card + FilterBar + table);
 *  - rail: [LivePanel] · Validity · Totals · Invoice · TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateQuote` / `createQuote`
 * actions (RBAC and RLS untouched). Status is an editable select (tenant list).
 * `mode: "create"` is the same page in new mode: Overview only, "After
 * creating" rail, gold "Create quote".
 */
export function QuoteScreen({
  mode,
  quote,
  client = null,
  clients = [],
  statuses = [],
  lockedClientId,
  cancelHref,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
  lineItems = [],
  clientAssets = [],
  articles = [],
  members = [],
  sourceWorkOrder = null,
  contract = null,
  invoice = null,
  canInvoice = false,
  defaultTab = "overview",
}: QuoteScreenProps) {
  const router = useRouter();
  const isCreate = mode === "create";
  const [tab, setTab] = useState<QuoteDetailTab>(defaultTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  const invoiceFlow = useQuoteInvoice(quote?.id ?? "", invoice);
  // An invoiced quote's lines are frozen in the database (issue #232); the
  // status covers viewers who cannot read the invoice itself (e.g. planner).
  const linesLocked = Boolean(invoice) || quote?.quote_status?.value === "invoiced";

  // ---- Edit mode ------------------------------------------------------------
  const record = useMemo<QuoteDraft>(
    () => (quote ? draftFromQuote(quote) : emptyDraft({ lockedClientId })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quote],
  );

  const schema = useMemo(
    () =>
      buildQuoteSchema({
        clientRequired: isCreate,
        statusLabel: (id) => statuses.find((item) => item.id === id)?.label ?? "",
        clientName: (id) => clients.find((item) => item.id === id)?.name ?? (client?.id === id ? client.name : ""),
      }),
    [clients, client, statuses, isCreate],
  );

  const createdIdRef = useRef<string | null>(null);
  const edit = useEditMode<QuoteDraft>({
    record,
    schema,
    initialMode: isCreate ? "new" : "read",
    canEdit: !isCreate && canUpdate,
    idPrefix: "quote",
    firstFieldKey: isCreate && !lockedClientId ? "clientId" : "name",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push(cancelHref ?? "/quotes"),
    onSave: async (draft, dirty) => {
      if (isCreate) {
        if (createdIdRef.current) {
          router.push(`/quotes/${createdIdRef.current}`);
          return { ok: true };
        }
        const { result, quoteId } = await createQuoteFromDraft(draft);
        if (!result.ok || !quoteId) return result;
        createdIdRef.current = quoteId;
        toast({ title: "Quote created", tone: "success", duration: 3000 });
        router.push(`/quotes/${quoteId}`);
        return { ok: true };
      }
      return saveQuoteEdits(quote!.id, draft, dirty);
    },
    onSaved: () => {
      if (isCreate) return;
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // ---- Derived data ---------------------------------------------------------
  const saved = edit.record;
  const today = useMemo(() => todayAmsterdam(), []);
  const totals = useMemo(() => quoteTotals(lineItems), [lineItems]);
  const daysLeft = quote ? getValidityDaysLeft({ quote_status: quote.quote_status, valid_until: saved.validUntil || null }, today) : null;

  // ---- Tabs -----------------------------------------------------------------
  function selectTab(next: QuoteDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(QUOTE_DETAIL_VIEW_KEY, next);
    });
  }

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      ...(isCreate ? [] : [{ id: "lineItems", label: "Line items", count: lineItems.length }]),
      // Generated documents (invoice) and their actions — shown once there is
      // an invoice or the viewer may make one.
      ...(!isCreate && (invoice || canInvoice) ? [{ id: "documents", label: "Documents", count: invoice ? 1 : 0 }] : []),
    ],
    [isCreate, lineItems.length, invoice, canInvoice],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // ---- Live panel -----------------------------------------------------------
  const livePanel = useMemo(
    () =>
      quote
        ? getLivePanel(
            {
              quote: { ...quote, valid_until: saved.validUntil || null },
              invoice,
              lineCount: lineItems.length,
              subtotal: totals.subtotal,
              canInvoice,
              canUpdate,
              today,
              generating: invoiceFlow.generating,
              sending: invoiceFlow.sending,
              onGenerate: invoiceFlow.requestGenerate,
              onSendInvoice: invoiceFlow.sendNow,
              onOpenPdf: invoiceFlow.openPdf,
              onEditValidity: () => {
                selectTab("overview");
                edit.startEdit();
              },
            },
            null,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quote, saved.validUntil, invoice, lineItems.length, totals.subtotal, canInvoice, canUpdate, today, invoiceFlow.generating, invoiceFlow.sending, edit.startEdit],
  );

  // ---- Header ---------------------------------------------------------------
  const title = isCreate ? "New quote" : saved.name || quote?.name || "Quote";

  const badges: PageHeaderBadge[] = [];
  if (quote) {
    badges.push({
      label: quote.quote_status?.label ?? "—",
      variant: quote.quote_status?.color ? (toneFromColor(quote.quote_status.color) as WebBadgeVariant) : "neutral",
    });
    if (daysLeft !== null && daysLeft < 0) badges.push({ label: "Expired", variant: "warning" });
    if (quote.quote_type === "contract") badges.push({ label: "Contract" });
    if (quote.is_auto_draft) badges.push({ label: "Auto-draft" });
  }

  // Invoice actions (generate / open PDF / send) live on the Documents tab;
  // the ··· menu keeps only Delete.
  const overflow: WebMenuItem[] = [];
  if (canDelete && quote) {
    overflow.push({ key: "delete", label: "Delete quote", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  const breadcrumb = isCreate
    ? lockedClientId && client
      ? [{ label: "Clients", href: "/clients" }, { label: client.name, href: `/clients/${client.id}` }, { label: "New quote" }]
      : [{ label: "Quotes", href: "/quotes" }, { label: "New quote" }]
    : [{ label: "Quotes", href: "/quotes" }, { label: quote?.quote_number ?? title, mono: true }];

  const header = (
    <PageHeader
      breadcrumb={breadcrumb}
      title={title}
      badges={badges}
      mode={edit.mode}
      actions={{
        canEdit: !isCreate && canUpdate && tab === "overview",
        onEdit: edit.startEdit,
        overflow,
        onSave: () => void edit.save(),
        onCancel: edit.requestCancel,
        saving: edit.saving,
        saveLabel: isCreate ? "Create quote" : "Save",
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as QuoteDetailTab)}
      tabsLabel="Quote sections"
      editStatus={edit.status}
    />
  );

  // ---- Timeline -------------------------------------------------------------
  const timeline = useMemo(
    () =>
      quote
        ? buildQuoteTimeline({
            quote,
            lineItems,
            invoice,
            sourceWorkOrder: sourceWorkOrder ? { id: sourceWorkOrder.id, label: workOrderLabel(sourceWorkOrder) } : null,
          })
        : [],
    [quote, lineItems, invoice, sourceWorkOrder],
  );

  // ---- Rail -----------------------------------------------------------------
  const rail =
    isCreate || !quote ? (
      <SidebarSection title="After creating">
        <p className="web-rail-empty">
          The quote opens on its own page, as a draft. Add its line items from the Line items tab there.
        </p>
      </SidebarSection>
    ) : (
      <QuoteRail
        livePanel={livePanel}
        validityDaysLeft={daysLeft}
        lineCount={lineItems.length}
        totals={totals}
        invoice={invoice}
        onShowLineItems={() => selectTab("lineItems")}
      />
    );

  const ids = webTabIds(tab);

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={rail}
        timeline={{
          items: timeline,
          emptyText: isCreate ? "The timeline starts once this record is created." : "No activity yet",
        }}
        locked={editing && !isCreate}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        {tab === "overview" && (
          <div className="web-tab-stack">
            <QuoteOverviewCards
              edit={edit}
              quote={quote}
              client={client}
              clients={clients}
              lockedClientId={lockedClientId}
              sourceWorkOrder={sourceWorkOrder}
              contract={contract}
              statuses={statuses}
              isNew={isCreate}
            />
          </div>
        )}

        {tab === "lineItems" && quote && (
          <QuoteLineItemsPanel
            quoteId={quote.id}
            lineItems={lineItems}
            clientAssets={clientAssets}
            articles={articles}
            members={members}
            canCreate={canCreate && !linesLocked}
            canUpdate={canUpdate && !linesLocked}
            canDelete={canDelete && !linesLocked}
          />
        )}

        {tab === "documents" && quote && (
          <QuoteDocumentsPanel
            invoice={invoice}
            canInvoice={canInvoice}
            canGenerate={canInvoice && lineItems.length > 0}
            flow={invoiceFlow}
          />
        )}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />
      {invoiceFlow.dialogs}

      {!isCreate && quote && deleteOpen && (
        <DeleteQuoteDialog quote={quote} open onOpenChange={setDeleteOpen} redirectOnDelete />
      )}
    </WebPage>
  );
}
