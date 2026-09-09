"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { Badge, FormGrid, IconButton, RecordHeroBand, RelationCard } from "@yourorg/ui";
import { Boxes, Building2, Clock, FileText, Pencil, Phone } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContactRecord } from "@/app/(app)/clients/contacts-actions";
import type { AssetContractCoverage, ContractRecord } from "@/app/(app)/contracts/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDate, formatDurationSince } from "@/lib/format/date";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { resolveRelation } from "@/lib/relation-cards/resolve-relation";
import type { ActivityDraft } from "./activity-draft";
import { ActivityRelationsDialog } from "./activity-relations-dialog";
import { ActivityStatusDialog } from "./activity-status-dialog";
import { useActivityContractCoverage } from "./use-activity-contract-coverage";

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
    contracts: ContractRecord[];
    loadingAssets: boolean;
    loadingContacts: boolean;
    loadingContracts: boolean;
  };
  readOnly?: boolean;
  actions?: ReactNode;
  /** Opens every gated section on the page into its inline-edit state at
   * once (`activity-screen.tsx`'s `pageEditing`) — omitted (along with the
   * pencil itself) once already editing, for a `readOnly` viewer, or in
   * `mode: "create"` (nothing to gate there, every field is already live).
   * Mirrors `ArticleHero`'s/`AssetHero`'s identical `onEditHeader` (issue
   * #133). Deliberately separate from the Status badge's own pencil just
   * below it in `meta` — that one is untouched, out of scope for issue #133
   * (same "cards/status keep their own pencil" precedent `ArticleScreen`'s
   * own module comment documents). */
  onEditHeader?: () => void;
  onClientChange: (clientId: string) => void;
  onRelationsSave: (
    patch: Pick<
      ActivityDraft,
      "clientId" | "assetId" | "contactPersonId" | "contactName" | "contactPhone" | "contactEmail"
    >,
  ) => Promise<{ ok: boolean; error?: string }>;
  onStatusSave: (patch: Pick<ActivityDraft, "statusId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The full-bleed dark hero band + the Client/Asset/Contract/Contact relation
 * cards at the top of the Activity detail/create screen
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
 * - `actions` is owned by the caller (`ActivityScreen`): the kebab
 *   (`ActivityDetailActions`) or the page's own Save/Cancel pair while dirty
 *   in edit mode, Cancel/Create in create mode.
 * - `onEditHeader` (issue #133) adds a second pencil into the same `meta`
 *   span, next to the status pencil — opens the page's own `pageEditing`,
 *   gating Type/Description/Solution/Contact person into their inline-edit
 *   form. `mode: "create"` never passes it (nothing to gate there).
 *
 * Still owns the two small popups (`ActivityStatusDialog`/
 * `ActivityRelationsDialog`, the latter NARROWED by issue #118 to only
 * Client/Asset/Contact-person — issue #127 briefly widened it to also cover
 * Contract, but issue #128 reversed that same-day, see that component's own
 * doc comment) behind the status pencil and the relation cards' own Edit
 * buttons.
 *
 * The Contract card is the one relation card with NO popup behind its Edit
 * button — it has none, by design (issue #128): a contract is never picked
 * for an activity directly, it's DERIVED from whichever asset (or, absent an
 * asset, client) the activity is already linked to. See `resolvedContract`/
 * `contractCoverage` below.
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
  onEditHeader,
  onClientChange,
  onRelationsSave,
  onStatusSave,
}: ActivityHeroProps) {
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // "Just-picked-locally vs. already-persisted" resolution — shared via
  // `resolveRelation` (issue #130); the Contract card just below is
  // deliberately NOT resolved this way — see its own comment.
  const resolvedClient = resolveRelation(draft.clientId, clients, client, (candidate) => candidate.id);
  const resolvedAsset = resolveRelation(draft.assetId, clientScoped.assets, asset, (candidate) => candidate.id);
  const resolvedContact = resolveRelation(draft.contactPersonId, clientScoped.contacts, undefined, (candidate) => candidate.id);
  const hasContactFacts = Boolean(resolvedContact?.name ?? draft.contactName);

  // Contract relation card — DERIVED, not stored (issue #128, same-day
  // reversal of #127's `contract_id` picker). Per the product-owner
  // reasoning: if you know the asset, you already know which contract(s)
  // cover it, so there's no separate FK to pick or edit here.
  //  - Asset set: the full direct+inherited coverage through that asset's
  //    composite tree (`useActivityContractCoverage`, issue #126's own
  //    `listAssetContractCoverage` — same source `AssetRelationCards`' own
  //    Contract card uses).
  //  - No asset, but a client: fall back to the client's own directly-linked
  //    contracts (`clientScoped.contracts` — already fetched for the
  //    relations dialog's Asset picker's client scoping, no further fetch
  //    needed).
  //  - Neither: empty.
  const contractCoverage = useActivityContractCoverage(draft.assetId || undefined);
  const [firstContractCoverage, ...restContractCoverage] = draft.assetId
    ? contractCoverage.coverage
    : draft.clientId
      ? clientScoped.contracts.map((contract): AssetContractCoverage => ({ contract, source: { type: "direct" } }))
      : [];
  const resolvedContract = firstContractCoverage?.contract ?? null;
  const contractLoading = Boolean(draft.assetId) && contractCoverage.loading && !resolvedContract;

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

  // Contract relation card subtitle — "{contract_type.label} · from
  // {start_date}", plus a "via {asset name}" hint whenever the first covering
  // contract is inherited (not directly linked to this activity's own
  // asset), plus a "+N more" suffix when more than one contract covers it —
  // same shape `AssetRelationCards`' own Contract card subtitle uses
  // (issue #126), reused here rather than reinvented.
  const contractFacts = resolvedContract
    ? [resolvedContract.contract_type?.label ?? null, `from ${formatDate(resolvedContract.start_date)}`]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";
  const contractFactsWithSource =
    firstContractCoverage?.source.type === "inherited"
      ? [contractFacts, `via ${firstContractCoverage.source.viaAsset.name}`].filter(Boolean).join(" · ")
      : contractFacts;
  const contractSubtitle =
    (restContractCoverage.length > 0
      ? `${contractFactsWithSource} · +${restContractCoverage.length} more`
      : contractFactsWithSource) || undefined;

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
      {/* Central header edit-pencil (issue #133, point 4) — opens the page's
          own `pageEditing` state, gating Type/Description/Solution/Contact
          person into their inline-edit form. */}
      {!readOnly && onEditHeader && (
        <IconButton variant="ghost" aria-label="Edit header" onClick={onEditHeader}>
          <Pencil />
        </IconButton>
      )}
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

      <FormGrid columns={4}>
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
          icon={FileText}
          label="Contract"
          loading={contractLoading}
          title={resolvedContract ? <Link href={`/contracts/${resolvedContract.id}`}>{resolvedContract.name}</Link> : undefined}
          subtitle={contractSubtitle}
          emptyText="No contract"
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
