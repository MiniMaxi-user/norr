import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
import { listQuotes } from "../actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { GenerateContractQuotesButton } from "./generate-contract-quotes-button";
import { parseQuotesQuery, type QuotesSearchParams } from "./quotes-query";
import { QuotesTable } from "./quotes-table";

export interface QuotesScreenProps {
  params: QuotesSearchParams;
  canGenerateContractQuotes: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canInvoice: boolean;
}

/** `/quotes` URL with the auto-draft toggle flipped, every other param kept
 * (page is dropped: the result set changes). */
function draftsToggleHref(params: QuotesSearchParams, showDrafts: boolean): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page" && key !== "drafts") qs.set(key, value);
  }
  if (!showDrafts) qs.set("drafts", "1");
  const query = qs.toString();
  return query ? `/quotes?${query}` : "/quotes";
}

/**
 * The data-fetching heart of the Quotes module — rendered inside a
 * `Suspense` boundary by `app/(app)/quotes/page.tsx` (fallback
 * `WebListSkeleton`). Renders the list-page shell (`WebListPage`): header
 * with count, the auto-draft toggle, "Generate contract quotes" (owner/
 * planner with the contracts module) and the navy "New quote" button, then
 * one server-driven table (search, filters, sort and pagination applied by
 * `listQuotes`, see `quotes-query.ts`).
 *
 * Issue #109: every work order auto-creates one `is_auto_draft` shadow
 * quote. They stay hidden by default (`isAutoDraft: false`); the header link
 * "Show auto-drafts" (`?drafts=1`) reveals them, and the table then marks
 * them "Concept" so they stay distinct from real quotes.
 */
export async function QuotesScreen({ params, canGenerateContractQuotes, canCreate, canDelete, canInvoice }: QuotesScreenProps) {
  const { page, showDrafts, options } = parseQuotesQuery(params);

  const [statusItemsResult, clientsResult, quotesResult] = await Promise.all([
    listReferenceItems("quote_status"),
    listClients({ limit: 200 }),
    listQuotes(options),
  ]);

  const actions = (
    <>
      <WebLinkButton href={draftsToggleHref(params, showDrafts)}>
        {showDrafts ? "Hide auto-drafts" : "Show auto-drafts"}
      </WebLinkButton>
      {canGenerateContractQuotes ? <GenerateContractQuotesButton /> : null}
    </>
  );
  const primary = canCreate ? (
    <WebLinkButton variant="primary" href="/quotes/new">
      New quote
    </WebLinkButton>
  ) : undefined;

  if (!quotesResult.data) {
    return (
      <WebListPage module="Quotes" title="Quotes" actions={actions} primary={primary}>
        <WebCard title="Quotes">
          <WebDataTableEmpty>{quotesResult.error ?? "Could not load quotes."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { quotes, count, unfilteredCount } = quotesResult.data;

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));

  // Inactive statuses stay out of the dropdown (they can still be on old quotes).
  const statusOptions = (statusItemsResult.data?.items ?? [])
    .filter((item) => item.is_active !== false)
    .map((item) => ({ value: item.value, label: item.label }));

  return (
    <WebListPage module="Quotes" title="Quotes" count={unfilteredCount ?? count} actions={actions} primary={primary}>
      <QuotesTable
        quotes={quotes}
        clientNameById={clientNameById}
        clientOptions={clientOptions}
        statusOptions={statusOptions}
        total={count}
        unfilteredTotal={unfilteredCount}
        page={page}
        showDraftBadge={showDrafts}
        canCreate={canCreate}
        canDelete={canDelete}
        canInvoice={canInvoice}
      />
    </WebListPage>
  );
}
