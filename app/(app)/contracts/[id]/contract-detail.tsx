"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumbs,
  Callout,
  KeyValueList,
  RecordHeroBand,
  RelationCard,
  SectionHeader,
  Stack,
  Text,
} from "@yourorg/ui";
import { AlertTriangle, Building2, CalendarDays, FileText } from "@yourorg/ui/icons";
import type { ContractRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";
import { usePageHeader } from "@/components/shell/page-header-context";
import { ContractDetailActions } from "./contract-detail-actions";

export interface ContractDetailProps {
  contract: ContractRecord;
  client: ClientRecord | null;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Contract detail's header + own fields — migrated onto the Work Order
 * visual pattern (issue #107): a full-bleed `RecordHeroBand` (title/type+SLA
 * badges/date-range meta/actions), a Client `RelationCard` as a sibling
 * below it, then a `SectionHeader` + `KeyValueList` for the contract's own
 * fields. `ContractAssetsPanel` (the many-to-many asset link list) stays
 * outside this component, rendered by `page.tsx` below it — see that
 * component's own doc comment for why it isn't wrapped in `Tabs`.
 */
export function ContractDetail({ contract, client, canEdit, canDelete }: ContractDetailProps) {
  const breadcrumbItems = useMemo(
    () => [{ label: "Contracts", href: "/contracts" }, { label: contract.name }],
    [contract.name],
  );
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const meta =
    contract.start_date && contract.end_date
      ? [
          <>
            <CalendarDays /> {formatDate(contract.start_date, { month: "long" })} –{" "}
            {formatDate(contract.end_date, { month: "long" })}
          </>,
        ]
      : [];

  return (
    <Stack gap="lg">
      <RecordHeroBand
        title={<h1 className="ui-record-hero-band-title">{contract.name}</h1>}
        badges={
          <>
            <Badge color={contract.contract_type?.color} variant="muted">
              {contract.contract_type?.label ?? "—"}
            </Badge>
            {contract.sla_tier && (
              <Badge color={contract.sla_tier.color} variant="muted">
                {contract.sla_tier.label}
              </Badge>
            )}
          </>
        }
        meta={meta}
        actions={<ContractDetailActions contract={contract} canEdit={canEdit} canDelete={canDelete} />}
      />

      <RelationCard
        icon={Building2}
        label="Client"
        title={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : undefined}
        emptyText="Unknown client"
      />

      <SectionHeader icon={FileText} title="Details" />
      <KeyValueList
        items={[
          { label: "Billing terms", value: <Text>{contract.billing_terms?.label ?? "—"}</Text> },
          { label: "Value", value: <Text>{formatCurrency(contract.value)}</Text> },
          { label: "Auto-renews", value: <Text>{contract.auto_renew ? "Yes" : "No"}</Text> },
          { label: "Start date", value: <Text>{formatDate(contract.start_date, { month: "long" })}</Text> },
          { label: "End date", value: <Text>{formatDate(contract.end_date, { month: "long" })}</Text> },
        ]}
      />

      {contract.notes && <Callout icon={AlertTriangle}>{contract.notes}</Callout>}
    </Stack>
  );
}
