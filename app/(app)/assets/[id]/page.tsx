import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Card, Heading, Stack, Text, Toolbar } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getAsset } from "../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { AssetDetailActions } from "./asset-detail-actions";

export const metadata = { title: "Asset details" };

interface AssetDetailPageProps {
  params: Promise<{ id: string }>;
}

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

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();

  const [assetResult, clientsResult, assetTypesResult, assetStatusesResult, assetSubtypesResult] =
    await Promise.all([
      getAsset(id),
      listClients({ limit: 200 }),
      listReferenceItems("asset_type"),
      listReferenceItems("asset_status"),
      listReferenceItems("asset_subtype"),
    ]);
  if (!assetResult.data) notFound();
  const asset = assetResult.data.asset;
  const clients = clientsResult.data?.clients ?? [];
  const assetTypes = assetTypesResult.data?.items ?? [];
  const assetStatuses = assetStatusesResult.data?.items ?? [];
  const assetSubtypes = assetSubtypesResult.data?.items ?? [];

  const clientResult = await getClient(asset.client_id);
  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === asset.site_id) ?? null;

  const canEdit = can(actor, "assets", "update") || can(actor, "assets", "update_own");
  const canDelete = can(actor, "assets", "delete");

  return (
    <Stack gap="lg">
      <Breadcrumbs items={[{ label: "Assets", href: "/assets" }, { label: asset.name }]} />

      <Toolbar>
        <Toolbar.Section>
          <Stack gap="xs">
            <Heading level={1}>{asset.name}</Heading>
            <Badge color={asset.asset_status?.color} variant="muted">
              {asset.asset_status?.label ?? "—"}
            </Badge>
          </Stack>
        </Toolbar.Section>
        <Toolbar.Section align="end">
          <AssetDetailActions
            asset={asset}
            clients={clients}
            assetTypes={assetTypes}
            assetStatuses={assetStatuses}
            assetSubtypes={assetSubtypes}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </Toolbar.Section>
      </Toolbar>

      <Card>
        <Stack gap="md">
          <DetailRow label="Type" value={asset.asset_type?.label ?? "—"} />
          <DetailRow label="Sub-type" value={asset.asset_subtype?.label ?? "—"} />
          <DetailRow label="Manufacturer" value={asset.manufacturer ?? "—"} />
          <DetailRow label="Model" value={asset.model ?? "—"} />
          <DetailRow label="Serial number" value={asset.serial_number ?? "—"} />
          <DetailRow label="Installed on" value={formatDate(asset.installed_at)} />
          <DetailRow label="Warranty until" value={formatDate(asset.warranty_until)} />
          <DetailRow
            label="Client"
            value={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client"}
          />
          <DetailRow
            label="Site"
            value={site ? `${site.name}${site.city ? ` — ${site.city}` : ""}` : "Unknown site"}
          />
          <DetailRow label="Notes" value={asset.notes ?? "—"} />
        </Stack>
      </Card>
    </Stack>
  );
}
