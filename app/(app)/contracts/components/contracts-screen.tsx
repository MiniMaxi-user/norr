import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import { listContracts } from "../actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { CreateContractButton } from "./create-contract-button";
import { ContractsTable } from "./contracts-table";

const LIST_PAGE_SIZE = 20;

export interface ContractsScreenProps {
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function buildPageHref(page: number): string {
  const qs = new URLSearchParams();
  if (page > 0) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/contracts?${query}` : "/contracts";
}

/**
 * The data-fetching heart of the Contracts module — rendered inside a
 * `Suspense` boundary by `app/(app)/contracts/page.tsx` so its shaped
 * skeleton shows while these `await`s resolve (route-level streaming, per
 * docs/ARCHITECTURE.md). A plain paginated list, same shape as
 * `app/(app)/work-orders/components/work-orders-screen.tsx`.
 */
export async function ContractsScreen({ page, canCreate, canEdit, canDelete }: ContractsScreenProps) {
  const offset = page * LIST_PAGE_SIZE;

  const [clientsResult, contractsResult] = await Promise.all([
    listClients({ limit: 200 }),
    listContracts({ limit: LIST_PAGE_SIZE, offset }),
  ]);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <Text tone="muted">
          {contractsResult.data ? `${contractsResult.data.count} contract${contractsResult.data.count === 1 ? "" : "s"}` : ""}
        </Text>
      </Toolbar.Section>
      <Toolbar.Section align="end">{canCreate && <CreateContractButton />}</Toolbar.Section>
    </Toolbar>
  );

  if (!contractsResult.data) {
    return (
      <>
        {toolbar}
        <Card>
          <Text tone="danger">{contractsResult.error ?? "Could not load contracts."}</Text>
        </Card>
      </>
    );
  }

  const { contracts, count } = contractsResult.data;

  if (contracts.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={<FileText />}
          heading="No contracts yet"
          text="Create your first service agreement to start tracking terms and coverage."
          action={canCreate ? <CreateContractButton /> : undefined}
        />
      </>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + contracts.length < count;

  return (
    <>
      {toolbar}
      <ContractsTable
        contracts={contracts}
        clientNameById={clientNameById}
        canEdit={canEdit}
        canDelete={canDelete}
      />
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + contracts.length, count)} of {count}
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
