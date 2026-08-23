import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Card, Heading, Stack, Text, Toolbar } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getContract, listContractAssets } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { listAssets } from "@/app/(app)/assets/actions";
import { ContractDetailActions } from "./contract-detail-actions";
import { ContractAssetsPanel } from "./contract-assets-panel";

export const metadata = { title: "Contract details" };

interface ContractDetailPageProps {
  params: Promise<{ id: string }>;
}

/** High enough for "every asset of this contract's client" in one request —
 * a contract detail page is a bounded, per-record view, same reasoning as
 * `ALL_CLIENT_ASSETS_LIMIT` in `app/(app)/clients/[id]/page.tsx`/
 * `app/(app)/work-orders/components/work-order-form.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text tone="muted">{label}</Text>
      <Text>{value}</Text>
    </Stack>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatValue(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * Contract detail page — same visual weight as the Client/Asset/Work Order
 * detail pages (docs/ARCHITECTURE.md "Relational detail pages"). Its
 * `contract_assets` many-to-many link is surfaced in-context via
 * `ContractAssetsPanel` below the main fields Card — a compact list +
 * inline add/remove, not a separate full page (see that component's own
 * comment for why it's not wrapped in `Tabs`).
 */
export default async function ContractDetailPage({ params }: ContractDetailPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();

  const contractResult = await getContract(id);
  if (!contractResult.data) notFound();
  const contract = contractResult.data.contract;

  const [clientResult, contractAssetsResult, clientAssetsResult] = await Promise.all([
    getClient(contract.client_id),
    listContractAssets(contract.id),
    listAssets({ clientId: contract.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
  ]);

  const client = clientResult.data?.client ?? null;
  const sites = clientResult.data?.sites ?? [];
  const siteNameById = new Map(sites.map((site) => [site.id, site.name]));
  const contractAssets = contractAssetsResult.data?.contractAssets ?? [];
  const clientAssets = clientAssetsResult.data?.assets ?? [];

  const canEdit = can(actor, "contracts", "update");
  const canDelete = can(actor, "contracts", "delete");
  const canLinkAssets = can(actor, "contracts", "create");
  const canUnlinkAssets = can(actor, "contracts", "delete");

  return (
    <Stack gap="lg">
      <Breadcrumbs items={[{ label: "Contracts", href: "/contracts" }, { label: contract.name }]} />

      <Toolbar>
        <Toolbar.Section>
          <Stack gap="xs">
            <Heading level={1}>{contract.name}</Heading>
            <Stack gap="xs">
              <Badge color={contract.contract_type?.color} variant="muted">
                {contract.contract_type?.label ?? "—"}
              </Badge>
              {contract.sla_tier && (
                <Badge color={contract.sla_tier.color} variant="muted">
                  {contract.sla_tier.label}
                </Badge>
              )}
            </Stack>
          </Stack>
        </Toolbar.Section>
        <Toolbar.Section align="end">
          <ContractDetailActions contract={contract} canEdit={canEdit} canDelete={canDelete} />
        </Toolbar.Section>
      </Toolbar>

      <Card>
        <Stack gap="md">
          <DetailRow
            label="Client"
            value={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client"}
          />
          <DetailRow label="Billing terms" value={contract.billing_terms?.label ?? "—"} />
          <DetailRow label="Value" value={formatValue(contract.value)} />
          <DetailRow label="Auto-renews" value={contract.auto_renew ? "Yes" : "No"} />
          <DetailRow label="Start date" value={formatDate(contract.start_date)} />
          <DetailRow label="End date" value={formatDate(contract.end_date)} />
          <DetailRow label="Notes" value={contract.notes ?? "—"} />
        </Stack>
      </Card>

      <ContractAssetsPanel
        contractId={contract.id}
        contractAssets={contractAssets}
        clientAssets={clientAssets}
        siteNameById={siteNameById}
        canLink={canLinkAssets}
        canUnlink={canUnlinkAssets}
      />
    </Stack>
  );
}
