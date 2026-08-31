import { notFound } from "next/navigation";
import { Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getContract, listContractAssets } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listAssets } from "@/app/(app)/assets/actions";
import { ContractDetail } from "./contract-detail";
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

/**
 * Contract detail page — same visual pattern as the Client/Asset/Work Order
 * detail pages (docs/ARCHITECTURE.md "Relational detail pages"): a full-bleed
 * `RecordHeroBand`, a Client `RelationCard`, and a `KeyValueList` of the
 * contract's own fields, all rendered by `ContractDetail` below. Its
 * `contract_assets` many-to-many link is surfaced in-context via
 * `ContractAssetsPanel` below that — a compact list + inline add/remove, not
 * a separate full page (see that component's own comment for why it's not
 * wrapped in `Tabs`).
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
  const siteLabelById = new Map(sites.map((site) => [site.id, formatSiteAddressShort(site)]));
  const contractAssets = contractAssetsResult.data?.contractAssets ?? [];
  const clientAssets = clientAssetsResult.data?.assets ?? [];

  const canEdit = can(actor, "contracts", "update");
  const canDelete = can(actor, "contracts", "delete");
  const canLinkAssets = can(actor, "contracts", "create");
  const canUnlinkAssets = can(actor, "contracts", "delete");

  return (
    <Stack gap="lg">
      <ContractDetail contract={contract} client={client} canEdit={canEdit} canDelete={canDelete} />

      <ContractAssetsPanel
        contractId={contract.id}
        contractAssets={contractAssets}
        clientAssets={clientAssets}
        siteLabelById={siteLabelById}
        canLink={canLinkAssets}
        canUnlink={canUnlinkAssets}
      />
    </Stack>
  );
}
