"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumbs,
  Callout,
  FormGrid,
  KeyValueList,
  RecordHeroBand,
  RelationCard,
  SectionHeader,
  Stack,
  Text,
} from "@yourorg/ui";
import { AlertTriangle, Boxes, Building2, MapPin } from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { formatDate } from "@/lib/format/date";
import { usePageHeader } from "@/components/shell/page-header-context";
import { AssetDetailActions } from "./asset-detail-actions";

export interface AssetDetailProps {
  asset: AssetRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  canEdit: boolean;
  canDelete: boolean;
  canCreateActivityFromAsset: boolean;
}

/**
 * Asset detail — migrated onto the Work Order visual pattern (issue #107):
 * a full-bleed `RecordHeroBand` (title/status badge/site meta/actions),
 * Client/Site `RelationCard`s as a sibling below it, then a `SectionHeader`
 * + `KeyValueList` for the asset's own fields. See
 * `app/(app)/work-orders/components/work-order-hero.tsx` for the reference
 * shape this mirrors.
 */
export function AssetDetail({
  asset,
  client,
  site,
  canEdit,
  canDelete,
  canCreateActivityFromAsset,
}: AssetDetailProps) {
  const breadcrumbItems = useMemo(
    () => [{ label: "Assets", href: "/assets" }, { label: asset.name }],
    [asset.name],
  );
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const meta = site
    ? [
        <>
          <MapPin /> {formatSiteAddressShort(site) ?? "Unknown site"}
        </>,
      ]
    : [];

  return (
    <Stack gap="lg">
      <RecordHeroBand
        title={<h1 className="ui-record-hero-band-title">{asset.name}</h1>}
        badges={
          <Badge color={asset.asset_status?.color} variant="muted">
            {asset.asset_status?.label ?? "—"}
          </Badge>
        }
        meta={meta}
        actions={
          <>
            {canCreateActivityFromAsset && <CreateActivityButton assetId={asset.id} label="New activity" />}
            <AssetDetailActions asset={asset} canEdit={canEdit} canDelete={canDelete} />
          </>
        }
      />

      <FormGrid columns={2}>
        <RelationCard
          icon={Building2}
          label="Client"
          title={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : undefined}
          emptyText="Unknown client"
        />
        <RelationCard
          icon={MapPin}
          label="Site"
          title={site ? formatSiteAddressShort(site) ?? undefined : undefined}
          emptyText="Unknown site"
        />
      </FormGrid>

      <SectionHeader icon={Boxes} title="Details" />
      <KeyValueList
        items={[
          { label: "Type", value: <Text>{asset.asset_type?.label ?? "—"}</Text> },
          { label: "Sub-type", value: <Text>{asset.asset_subtype?.label ?? "—"}</Text> },
          { label: "Brand", value: <Text>{asset.asset_brand?.label ?? "—"}</Text> },
          { label: "Model", value: <Text>{asset.asset_model?.name ?? "—"}</Text> },
          { label: "External reference", value: <Text>{asset.external_reference ?? "—"}</Text> },
          { label: "Serial number", value: <Text>{asset.serial_number ?? "—"}</Text> },
          { label: "Installed on", value: <Text>{formatDate(asset.installed_at, { month: "long" })}</Text> },
          { label: "Warranty until", value: <Text>{formatDate(asset.warranty_until, { month: "long" })}</Text> },
        ]}
      />

      {asset.notes && <Callout icon={AlertTriangle}>{asset.notes}</Callout>}
    </Stack>
  );
}
