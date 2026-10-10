import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import { listQuotes, type QuoteType } from "../actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { CreateQuoteButton } from "./create-quote-button";
import { QuotesTable } from "./quotes-table";
import { QuotesFilters } from "./quotes-filters";
import { GenerateContractQuotesButton } from "./generate-contract-quotes-button";

const LIST_PAGE_SIZE = 20;

export interface QuotesScreenProps {
  page: number;
  /** Issue #109 — `true` reveals auto-draft (system-managed shadow) quotes
   * alongside "real" ones; `false` (the default) filters them out entirely
   * via `listQuotes({ isAutoDraft: false })`, matching the list's own
   * `count`/pagination to whichever set is actually showing. See the module
   * comment below for why a filter (not just a badge) is the default. */
  showDrafts: boolean;
  /** Raw `?status=` selection (quote_status item values); `undefined` = default (Draft). */
  statusFilter?: string[];
  /** Raw `?type=` selection; `undefined` = default (Default). */
  typeFilter?: string[];
  canGenerateContractQuotes: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const TYPE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "contract", label: "Contract" },
];

function buildPageHref(page: number, showDrafts: boolean, statusFilter?: string[], typeFilter?: string[]): string {
  const qs = new URLSearchParams();
  if (page > 0) qs.set("page", String(page));
  if (showDrafts) qs.set("drafts", "1");
  if (statusFilter) qs.set("status", statusFilter.join(","));
  if (typeFilter) qs.set("type", typeFilter.join(","));
  const query = qs.toString();
  return query ? `/quotes?${query}` : "/quotes";
}

/**
 * The data-fetching heart of the Quotes module — rendered inside a
 * `Suspense` boundary by `app/(app)/quotes/page.tsx` so its shaped skeleton
 * shows while these `await`s resolve (route-level streaming, per
 * docs/ARCHITECTURE.md). A plain paginated list, same shape as
 * `app/(app)/contracts/components/contracts-screen.tsx`.
 *
 * *** Issue #109 *** — every work order now auto-creates exactly one
 * `is_auto_draft = true` quote (`quotes.is_auto_draft`, see
 * `app/(app)/work-orders/quote-sync-actions.ts`'s header comment), kept in
 * sync until "Create Quote" promotes it. Left unfiltered, `/quotes` would
 * show one shadow-quote row per work order forever — a real cost for a
 * planner trying to find an actual proposal among them. Default view
 * (`showDrafts: false`) filters auto-drafts out entirely
 * (`listQuotes({ isAutoDraft: false })`) rather than merely badging them, per
 * the issue's own instruction; a small toolbar toggle
 * ("Show draft quotes"/"Hide draft quotes") switches to the unfiltered set
 * for a planner who legitimately wants to browse/find one (e.g. to check its
 * live frozen total before clicking "Create Quote" on the work order itself).
 * `QuotesTable` still badges each auto-draft row "Concept" whenever it IS
 * showing (`showDrafts: true`) — the badge and the filter are complementary,
 * not alternatives: the filter keeps the default list clean, the badge keeps
 * an auto-draft visually distinct from a "real" quote the moment a planner
 * does choose to look at both together.
 */
export async function QuotesScreen({
  page,
  showDrafts,
  statusFilter,
  typeFilter,
  canGenerateContractQuotes,
  canCreate,
  canEdit,
  canDelete,
}: QuotesScreenProps) {
  const offset = page * LIST_PAGE_SIZE;

  const statusItemsResult = await listReferenceItems("quote_status");
  const statusOptions = (statusItemsResult.data?.items ?? [])
    .filter((item) => item.is_active !== false)
    .map((item) => ({ value: item.value, label: item.label }));

  // Absent param = default (Draft only / Default only). A selection covering
  // every option is "no filter" (so quotes with a since-deactivated status
  // still show when "All" is chosen).
  const selectedStatuses = (statusFilter ?? ["draft"]).filter((value) => statusOptions.some((o) => o.value === value));
  const selectedTypes = (typeFilter ?? ["default"]).filter((value): value is QuoteType =>
    TYPE_OPTIONS.some((o) => o.value === value),
  );
  const allStatuses = statusOptions.length > 0 && selectedStatuses.length === statusOptions.length;
  const allTypes = selectedTypes.length === TYPE_OPTIONS.length;

  const [clientsResult, quotesResult] = await Promise.all([
    listClients({ limit: 200 }),
    listQuotes({
      limit: LIST_PAGE_SIZE,
      offset,
      isAutoDraft: showDrafts ? undefined : false,
      status: statusOptions.length === 0 || allStatuses ? undefined : selectedStatuses,
      type: allTypes ? undefined : selectedTypes,
    }),
  ]);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <QuotesFilters
          statusOptions={statusOptions}
          typeOptions={TYPE_OPTIONS}
          selectedStatuses={selectedStatuses}
          selectedTypes={selectedTypes}
        />
        <Text tone="muted">
          {quotesResult.data ? `${quotesResult.data.count} quote${quotesResult.data.count === 1 ? "" : "s"}` : ""}
        </Text>
      </Toolbar.Section>
      <Toolbar.Section align="end">
        <Link href={buildPageHref(0, !showDrafts, statusFilter, typeFilter)}>
          <Button type="button" variant="outline" size="sm">
            {showDrafts ? "Hide draft quotes" : "Show draft quotes"}
          </Button>
        </Link>
        {canGenerateContractQuotes && <GenerateContractQuotesButton />}
        {canCreate && <CreateQuoteButton />}
      </Toolbar.Section>
    </Toolbar>
  );

  if (!quotesResult.data) {
    return (
      <>
        {toolbar}
        <Card>
          <Text tone="danger">{quotesResult.error ?? "Could not load quotes."}</Text>
        </Card>
      </>
    );
  }

  const { quotes, count } = quotesResult.data;

  if (quotes.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={<ClipboardList />}
          heading="No quotes found"
          text="No quotes match the current filters. Adjust the Status or Type filter, or create a new proposal."
          action={canCreate ? <CreateQuoteButton /> : undefined}
        />
      </>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + quotes.length < count;

  return (
    <>
      {toolbar}
      <QuotesTable
        quotes={quotes}
        clientNameById={clientNameById}
        canEdit={canEdit}
        canDelete={canDelete}
        showDraftBadge={showDrafts}
      />
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + quotes.length, count)} of {count}
        </Text>
        <span>
          {hasPrev ? (
            <Link href={buildPageHref(page - 1, showDrafts, statusFilter, typeFilter)}>
              <Button type="button" variant="outline" size="sm">
                Previous
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}{" "}
          {hasNext ? (
            <Link href={buildPageHref(page + 1, showDrafts, statusFilter, typeFilter)}>
              <Button type="button" variant="outline" size="sm">
                Next
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </span>
      </Stack>
    </>
  );
}
