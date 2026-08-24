import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import { listQuotes } from "../actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { CreateQuoteButton } from "./create-quote-button";
import { QuotesTable } from "./quotes-table";

const LIST_PAGE_SIZE = 20;

export interface QuotesScreenProps {
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function buildPageHref(page: number): string {
  const qs = new URLSearchParams();
  if (page > 0) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/quotes?${query}` : "/quotes";
}

/**
 * The data-fetching heart of the Quotes module — rendered inside a
 * `Suspense` boundary by `app/(app)/quotes/page.tsx` so its shaped skeleton
 * shows while these `await`s resolve (route-level streaming, per
 * docs/ARCHITECTURE.md). A plain paginated list, same shape as
 * `app/(app)/contracts/components/contracts-screen.tsx`.
 */
export async function QuotesScreen({ page, canCreate, canEdit, canDelete }: QuotesScreenProps) {
  const offset = page * LIST_PAGE_SIZE;

  const [clientsResult, quotesResult] = await Promise.all([
    listClients({ limit: 200 }),
    listQuotes({ limit: LIST_PAGE_SIZE, offset }),
  ]);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <Text tone="muted">
          {quotesResult.data ? `${quotesResult.data.count} quote${quotesResult.data.count === 1 ? "" : "s"}` : ""}
        </Text>
      </Toolbar.Section>
      <Toolbar.Section align="end">{canCreate && <CreateQuoteButton />}</Toolbar.Section>
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
          heading="No quotes yet"
          text="Create your first proposal to start pricing work for a client."
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
      <QuotesTable quotes={quotes} clientNameById={clientNameById} canEdit={canEdit} canDelete={canDelete} />
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + quotes.length, count)} of {count}
        </Text>
        <span>
          {hasPrev ? (
            <Link href={buildPageHref(page - 1)}>
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
            <Link href={buildPageHref(page + 1)}>
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
