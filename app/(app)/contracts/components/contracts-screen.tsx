import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
import { listContracts } from "../actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { parseContractsQuery, type ContractsSearchParams } from "./contracts-query";
import { ContractsTable } from "./contracts-table";

export interface ContractsScreenProps {
  params: ContractsSearchParams;
  canCreate: boolean;
  canDelete: boolean;
}

/**
 * The data-fetching heart of the Contracts module — rendered inside a
 * `Suspense` boundary by `app/(app)/contracts/page.tsx` (fallback
 * `WebListSkeleton`). Renders the list-page shell (`WebListPage`): header
 * with count and the navy "New contract" button, then one server-driven
 * table. Search, filters, sort and pagination come from the URL
 * (`contracts-query.ts`) and are applied by `listContracts`.
 */
export async function ContractsScreen({ params, canCreate, canDelete }: ContractsScreenProps) {
  const { page, options } = parseContractsQuery(params);

  const [clientsResult, contractsResult, typesResult, slaTiersResult] = await Promise.all([
    listClients({ limit: 200 }),
    listContracts(options),
    listReferenceItems("contract_type"),
    listReferenceItems("sla_tier"),
  ]);

  const primary = canCreate ? (
    <WebLinkButton variant="primary" href="/contracts/new">
      New contract
    </WebLinkButton>
  ) : undefined;

  if (!contractsResult.data) {
    return (
      <WebListPage module="Contracts" title="Contracts" primary={primary}>
        <WebCard title="Contracts">
          <WebDataTableEmpty>{contractsResult.error ?? "Could not load contracts."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { contracts, count, unfilteredCount } = contractsResult.data;

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));

  // The picklists need settings access; fall back to the values on this page.
  const distinct = (pick: (contract: (typeof contracts)[number]) => { id: string; label: string } | null) => {
    const seen = new Map<string, string>();
    for (const contract of contracts) {
      const item = pick(contract);
      if (item && !seen.has(item.id)) seen.set(item.id, item.label);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  };
  const typeOptions = typesResult.data
    ? typesResult.data.items.map((item) => ({ value: item.id, label: item.label }))
    : distinct((c) => (c.contract_type ? { id: c.type_id, label: c.contract_type.label } : null));
  const slaTierOptions = slaTiersResult.data
    ? slaTiersResult.data.items.map((item) => ({ value: item.id, label: item.label }))
    : distinct((c) => (c.sla_tier && c.sla_tier_id ? { id: c.sla_tier_id, label: c.sla_tier.label } : null));

  return (
    <WebListPage module="Contracts" title="Contracts" count={unfilteredCount ?? count} primary={primary}>
      <ContractsTable
        contracts={contracts}
        clientNameById={clientNameById}
        clientOptions={clientOptions}
        typeOptions={typeOptions}
        slaTierOptions={slaTierOptions}
        total={count}
        unfilteredTotal={unfilteredCount}
        page={page}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </WebListPage>
  );
}
