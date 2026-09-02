"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { Badge, FormGrid, IconButton, RecordHeroBand, RelationCard } from "@yourorg/ui";
import { Boxes, Building2, Clock, Pencil, Phone } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContactRecord } from "@/app/(app)/clients/contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDurationSince } from "@/lib/format/date";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import type { ActivityDraft } from "./activity-draft";
import { ActivityRelationsDialog } from "./activity-relations-dialog";
import { ActivityStatusDialog } from "./activity-status-dialog";

export interface ActivityHeroProps {
  mode: "create" | "edit";
  draft: ActivityDraft;
  activity?: ActivityRecord;
  client: ClientRecord | null;
  asset: AssetRecord | null;
  clients: ClientRecord[];
  activityTypes: ReferenceListItemRecord[];
  activityStatuses: ReferenceListItemRecord[];
  lockedClientId?: string;
  lockedAssetId?: string;
  clientScoped: {
    assets: AssetRecord[];
    contacts: ContactRecord[];
    sites: SiteRecord[];
    loadingAssets: boolean;
    loadingContacts: boolean;
  };
  readOnly?: boolean;
  actions?: ReactNode;
  onClientChange: (clientId: string) => void;
  onRelationsSave: (
    patch: Pick<ActivityDraft, "clientId" | "assetId" | "contactPersonId" | "contactName" | "contactPhone" | "contactEmail">,
  ) => Promise<{ ok: boolean; error?: string }>;
  onStatusSave: (patch: Pick<ActivityDraft, "statusId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The full-bleed dark hero band + the Client/Asset/Contact relation cards at
 * the top of the Activity detail/create screen
 * (`.design-handoff/melding_detail/README.md`) — the Activity equivalent of
 * `WorkOrderHero`, rebuilt for issue #118's Pattern A redesign:
 *
 * - `title` is now plain static text (the resolved Type's label) — NOT
 *   inline-editable, unlike a work order's own title (Activities have no
 *   free-text title of their own, and Type editing lives in its own flat
 *   "Type" section below now, not a hero pencil).
 * - `meta`'s first item is a status badge PLUS a plain-text type badge
 *   together. The status badge keeps its own edit-pencil (opening
 *   `ActivityStatusDialog`, unchanged) even though the mockup's static HTML
 *   doesn't draw one — a deliberate, explicitly-approved deviation
 *   preserving existing working functionality the mockup simply didn't
 *   render a hover/interactive state for. The type badge has no pencil
 *   (Type is edited in its own section now).
 * - No stats strip — `noStats` on `RecordHeroBand` stands in for the bottom
 *   padding a stats strip would otherwise provide.
 * - `actions` is owned by the caller (`ActivityScreen`): just the kebab
 *   (`ActivityDetailActions`) in edit mode, Cancel/Create in create mode.
 *
 * Still owns the two small popups (`ActivityStatusDialog`/
 * `ActivityRelationsDialog`, the latter NARROWED by issue #118 to only
 * Client/Asset/Contact-person — see that component's own doc comment)
 * behind the status pencil and the relation cards' own Edit buttons.
 */
export function ActivityHero({
  mode,
  draft,
  activity,
  client,
  asset,
  clients,
  activityTypes,
  activityStatuses,
  lockedClientId,
  lockedAssetId,
  clientScoped,
  readOnly,
  actions,
  onClientChange,
  onRelationsSave,
  onStatusSave,
}: ActivityHeroProps) {
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const resolvedClient = draft.clientId
    ? (client?.id === draft.clientId ? client : (clients.find((candidate) => candidate.id === draft.clientId) ?? null))
    : null;
  const resolvedAsset = draft.assetId
    ? (clientScoped.assets.find((candidate) => candidate.id === draft.assetId) ??
      (asset?.id === draft.assetId ? asset : null))
    : null;
  const resolvedContact = draft.contactPersonId
    ? (clientScoped.contacts.find((candidate) => candidate.id === draft.contactPersonId) ?? null)
    : null;
  const hasContactFacts = Boolean(resolvedContact?.name ?? draft.contactName);

  const selectedType = activityTypes.find((item) => item.id === draft.typeId);
  const statusLabel = activityStatuses.find((item) => item.id === draft.statusId)?.label ?? activity?.activity_status?.label;
  const statusColor = activityStatuses.find((item) => item.id === draft.statusId)?.color ?? activity?.activity_status?.color;

  // Client relation card subtitle — "KvK {kvk_number} · {primary site
  // address short}", degrading gracefully (dropping whichever half is
  // missing, then the whole subtitle) rather than inventing a fake fact —
  // not every client necessarily has a KvK number or a primary site.
  const primarySite = clientScoped.sites.find((site) => site.is_primary) ?? null;
  const clientSubtitle =
    [
      resolvedClient?.kvk_number ? `KvK ${resolvedClient.kvk_number}` : null,
      formatSiteAddressShort(primarySite),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ") || undefined;

  // Asset relation card subtitle — "{asset_type.label} · {location}". An
  // asset has no embedded site record (`AssetRecord.site_id` is a bare FK,
  // see `app/(app)/assets/actions.ts`), so its site is looked up against the
  // same client-scoped `sites` list the Client card's own primary-site
  // subtitle already uses above — falls back to the asset type label alone
  // when no matching site is found, rather than inventing a fake location.
  const assetSite = resolvedAsset ? (clientScoped.sites.find((site) => site.id === resolvedAsset.site_id) ?? null) : null;
  const assetSubtitle =
    [resolvedAsset?.asset_type?.label ?? null, formatSiteAddressShort(assetSite)]
      .filter((part): part is string => Boolean(part))
      .join(" · ") || undefined;

  const meta: ReactNode[] = [
    <span className="ui-record-hero-band-meta-badges" key="status">
      {mode === "edit" && activity ? (
        <Badge color={statusColor} variant="muted">
          {statusLabel ?? "—"}
        </Badge>
      ) : (
        <Badge variant="accent">New</Badge>
      )}
      {/* Deliberate deviation from the mockup's static HTML (issue #118):
          it doesn't draw a pencil next to the status badge, but this was
          working functionality worth preserving — explicitly approved, same
          reasoning documented on this file's own module comment. */}
      {!readOnly && (
        <IconButton variant="ghost" aria-label="Edit status" onClick={() => setStatusOpen(true)}>
          <Pencil />
        </IconButton>
      )}
      {selectedType && <Badge variant="muted">{selectedType.label}</Badge>}
    </span>,
  ];
  if (resolvedClient) {
    meta.push(
      <>
        <Building2 /> {resolvedClient.name}
      </>,
    );
  }
  if (mode === "edit" && activity) {
    meta.push(
      <>
        <Clock /> Open sinds {formatDurationSince(activity.reported_at)}
      </>,
    );
  }

  return (
    <>
      <RecordHeroBand
        title={<h1 className="ui-record-hero-band-title">{selectedType?.label ?? "New activity"}</h1>}
        meta={meta}
        actions={actions}
        noStats
      />

      <FormGrid columns={3}>
        <RelationCard
          icon={Building2}
          label="Client"
          title={resolvedClient ? <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link> : undefined}
          subtitle={clientSubtitle}
          emptyText="No client selected yet"
          onEdit={readOnly ? undefined : () => setRelationsOpen(true)}
        />
        <RelationCard
          icon={Boxes}
          label="Asset"
          loading={clientScoped.loadingAssets && Boolean(draft.assetId) && !resolvedAsset}
          title={resolvedAsset ? <Link href={`/assets/${resolvedAsset.id}`}>{resolvedAsset.name}</Link> : undefined}
          subtitle={assetSubtitle}
          emptyText="No specific asset"
          onEdit={readOnly ? undefined : () => setRelationsOpen(true)}
        />
        <RelationCard
          icon={Phone}
          label="Contact person"
          loading={clientScoped.loadingContacts && Boolean(draft.contactPersonId) && !resolvedContact}
          title={resolvedContact?.name ?? draft.contactName ?? undefined}
          subtitle={hasContactFacts ? "Wie er over deze melding gebeld wordt" : undefined}
          emptyText="No contact set"
          onEdit={readOnly ? undefined : () => setRelationsOpen(true)}
        />
      </FormGrid>

      {relationsOpen && (
        <ActivityRelationsDialog
          open
          onOpenChange={setRelationsOpen}
          draft={draft}
          clients={clients}
          activityTypes={activityTypes}
          lockedClientId={lockedClientId}
          lockedAssetId={lockedAssetId}
          clientScoped={clientScoped}
          onClientChange={onClientChange}
          onSave={onRelationsSave}
        />
      )}

      {statusOpen && (
        <ActivityStatusDialog
          open
          onOpenChange={setStatusOpen}
          draft={draft}
          activityStatuses={activityStatuses}
          onSave={onStatusSave}
        />
      )}
    </>
  );
}
