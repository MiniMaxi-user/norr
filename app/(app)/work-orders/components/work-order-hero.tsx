"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, IconButton, RecordHeroBand, StatStrip, type StatStripItem } from "@yourorg/ui";
import { CalendarDays, MapPin, Pencil } from "@yourorg/ui/icons";
import type { WorkOrderRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { formatDateTime } from "@/lib/format/date";
import type { WorkOrderDraft } from "./work-order-draft";
import { WorkOrderRelationCards } from "./work-order-relation-cards";
import { WorkOrderRelationsDialog } from "./work-order-relations-dialog";
import { WorkOrderStatusPriorityDialog } from "./work-order-status-priority-dialog";

export interface WorkOrderHeroProps {
  mode: "create" | "edit";
  draft: WorkOrderDraft;
  workOrder?: WorkOrderRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  asset: AssetRecord | null;
  contract: ContractRecord | null;
  clientScoped: {
    sites: SiteRecord[];
    assets: AssetRecord[];
    contracts: ContractRecord[];
    loadingSites: boolean;
    loadingAssets: boolean;
    loadingContracts: boolean;
  };
  clients: ClientRecord[];
  lockedClientId?: string;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  readOnly?: boolean;
  /** Hours/Material/Checklist KPI tiles — computed by `WorkOrderScreen` from
   * the data it already fetched/holds, kept out of this component so it
   * doesn't also need the raw time entries/articles/checklist items. */
  stats: StatStripItem[];
  /** `WorkOrderDetailActions` in edit mode, or a Cancel/Create pair in create
   * mode — owned by `WorkOrderScreen`, just slotted in here. */
  actions?: ReactNode;
  onTitleChange: (value: string) => void;
  onTitleBlur: (value: string) => void;
  onClientChange: (clientId: string) => void;
  onRelationsSave: (
    patch: Pick<WorkOrderDraft, "clientId" | "siteId" | "assetId" | "contractId">,
  ) => Promise<{ ok: boolean; error?: string }>;
  onStatusPrioritySave: (
    patch: Pick<WorkOrderDraft, "statusId" | "priorityId">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The full-bleed dark hero band + the Client/Site/Asset/Contract relation
 * cards at the top of the redesigned work order screen (issue #102, revised
 * by issue #103, further shortened by issue #106). `RecordHeroBand` (title/
 * meta/actions/stats) is now a full-bleed sibling BEFORE any `Card` — see
 * that component's own doc comment for why it can no longer share a rounded
 * `Card className="ui-card-flush-xl"` "sheet" with the relation cards the
 * way issue #102 originally had it. `WorkOrderRelationCards` now renders
 * directly on the page's own (normally padded) background instead — each of
 * its four `RelationCard`s is ALREADY its own bordered `Card`
 * (`packages/ui/src/components/relation-card.tsx`), so once they're out of
 * that shared dark-band sheet (where their individual borders read as just
 * more content floating inside an already-framed surface) they stand on
 * their own as properly framed cards, same "several individually-bordered
 * fact cards on the plain page background" pattern
 * `app/(app)/clients/[id]/client-detail.tsx`'s rail already uses — issue
 * #103's "no frame" complaint, not a missing border to add. Renders both as
 * a fragment, not a single wrapping element, so `WorkOrderScreen`'s own
 * `Stack` puts its usual gap between the two. Owns the two small popups
 * (`WorkOrderStatusPriorityDialog`/`WorkOrderRelationsDialog`) behind the
 * status/priority pencil and the relation cards' own Edit buttons —
 * everything else (Hours/Material/Checklist/Assignment) is a sibling below
 * this, assembled by `WorkOrderScreen` itself.
 *
 * *** Issue #106 *** shortened the band by folding the status/priority
 * badges (+ their edit-pencil) that used to sit on their OWN row above the
 * title into the same meta row as the site/scheduled-date facts (as the
 * FIRST meta item) — one fewer row of vertical space, same click-to-edit
 * popup behavior. It also removed the `assignee` block entirely: the
 * assigned engineer now surfaces in `WorkOrderHoursSection` instead (closer
 * to the hours actually being logged against them), and `actions`
 * (Create Quote/Delete in edit mode) now occupies the hero's right column on
 * its own rather than sharing it with the assignee underneath.
 *
 * No `recordLabel`/breadcrumb line and no `topRight` "Created …" line inside
 * the band (issue #103, items #1/#8): the page's own `Breadcrumbs` (Topbar)
 * already says "Work Orders / …", so repeating it here was redundant, and
 * "Created …" now lives in `WorkOrderAssignmentSection`'s key/value list
 * instead.
 */
export function WorkOrderHero({
  mode,
  draft,
  workOrder,
  client,
  site,
  asset,
  contract,
  clientScoped,
  clients,
  lockedClientId,
  statuses,
  priorities,
  readOnly,
  stats,
  actions,
  onTitleChange,
  onTitleBlur,
  onClientChange,
  onRelationsSave,
  onStatusPrioritySave,
}: WorkOrderHeroProps) {
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const resolvedSite =
    clientScoped.sites.find((candidate) => candidate.id === draft.siteId) ??
    (draft.siteId && site?.id === draft.siteId ? site : null);

  // Issue #106 — status/priority (+ their edit-pencil) used to be their own
  // `badges` row above the title; folded into the meta row as its own first
  // item instead so the band ends up one row shorter, same edit-popup
  // behavior underneath.
  const meta: ReactNode[] = [
    <span className="ui-record-hero-band-meta-badges" key="status-priority">
      {mode === "edit" && workOrder ? (
        <>
          <Badge color={workOrder.work_order_status?.color} variant="muted">
            {workOrder.work_order_status?.label ?? "—"}
          </Badge>
          {workOrder.work_order_priority && (
            <Badge color={workOrder.work_order_priority.color} variant="muted">
              {workOrder.work_order_priority.label}
            </Badge>
          )}
        </>
      ) : (
        <Badge variant="accent">New</Badge>
      )}
      {!readOnly && (
        <IconButton variant="ghost" aria-label="Edit status &amp; priority" onClick={() => setStatusOpen(true)}>
          <Pencil />
        </IconButton>
      )}
    </span>,
  ];
  if (resolvedSite) {
    meta.push(
      <>
        <MapPin /> {formatSiteAddressShort(resolvedSite) ?? "Unnamed site"}
      </>,
    );
  }
  if (draft.scheduledAt) {
    meta.push(
      <>
        <CalendarDays /> {formatDateTime(draft.scheduledAt, { month: "long" })}
      </>,
    );
  }

  return (
    <>
      <RecordHeroBand
        title={
          readOnly ? (
            <h1 className="ui-record-hero-band-title">{draft.title || "Untitled work order"}</h1>
          ) : (
            <input
              className="ui-record-hero-band-title-input"
              value={draft.title}
              placeholder="Untitled work order — click to name it"
              aria-label="Work order title"
              onChange={(event) => onTitleChange(event.target.value)}
              onBlur={(event) => onTitleBlur(event.target.value)}
            />
          )
        }
        meta={meta}
        actions={actions}
        stats={<StatStrip items={stats} />}
      />

      <WorkOrderRelationCards
        draft={draft}
        client={client}
        site={site}
        asset={asset}
        contract={contract}
        clients={clients}
        clientScoped={clientScoped}
        readOnly={readOnly}
        onEdit={() => setRelationsOpen(true)}
      />

      {relationsOpen && (
        <WorkOrderRelationsDialog
          open
          onOpenChange={setRelationsOpen}
          draft={draft}
          clients={clients}
          lockedClientId={lockedClientId}
          clientScoped={clientScoped}
          onClientChange={onClientChange}
          onSave={onRelationsSave}
        />
      )}

      {statusOpen && (
        <WorkOrderStatusPriorityDialog
          open
          onOpenChange={setStatusOpen}
          draft={draft}
          statuses={statuses}
          priorities={priorities}
          onSave={onStatusPrioritySave}
        />
      )}
    </>
  );
}
