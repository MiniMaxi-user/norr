"use client";

import { useRouter } from "next/navigation";
import { Badge, LinkedRecordsTable, SectionHeader, Stack } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { CreateContractButton } from "@/app/(app)/contracts/components/create-contract-button";
import { formatDate } from "@/lib/format/date";

export interface ContractsPanelProps {
  clientId: string;
  contracts: ContractRecord[];
  /** `can(actor, "contracts", "create")`, resolved once in `page.tsx` — same
   * gate the standalone Contracts module page uses for its own "New
   * contract" button, reused here for this tab's own "+ Contract" button
   * (issue #113 follow-up). */
  canCreate: boolean;
}

/**
 * "Contracts" tab on the Client detail page (docs/ARCHITECTURE.md
 * "Relational detail pages") — every service agreement against this client,
 * each row linking to the real Contracts module's detail page.
 *
 * "+ Contract" opens the real `/contracts/new?clientId=...` create page
 * (Contracts is a top-level module — docs/ARCHITECTURE.md "Popup vs. full
 * page" keeps its create/edit a real page, never a `Dialog`), via
 * `CreateContractButton`'s existing `clientId` prop, which pre-fills/locks
 * that page's own Client field to this client. This tab's own row list stays
 * otherwise read-only (no inline edit/delete) — those actions stay on
 * `/contracts` and `/contracts/[id]`.
 */
export function ContractsPanel({ clientId, contracts, canCreate }: ContractsPanelProps) {
  const router = useRouter();

  return (
    <Stack gap="md">
      <SectionHeader
        icon={FileText}
        title="Contracts"
        actions={canCreate && <CreateContractButton clientId={clientId} label="+ Contract" size="sm" />}
      />

      <LinkedRecordsTable
        records={contracts}
        getKey={(contract) => contract.id}
        onRowClick={(contract) => router.push(`/contracts/${contract.id}`)}
        emptyIcon={<FileText />}
        emptyHeading="No contracts yet"
        emptyText="Service agreements for this client will show up here."
        columns={[
          { header: "Name", render: (contract) => contract.name },
          {
            header: "Type",
            align: "center",
            render: (contract) => (
              <Badge color={contract.contract_type?.color} variant="muted">
                {contract.contract_type?.label ?? "—"}
              </Badge>
            ),
          },
          { header: "Start date", render: (contract) => formatDate(contract.start_date) },
          { header: "End date", render: (contract) => formatDate(contract.end_date) },
        ]}
      />
    </Stack>
  );
}
