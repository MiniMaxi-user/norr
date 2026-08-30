"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Avatar, Badge, Card, IconButton, RecordHeroBand, StatStrip, type StatStripItem } from "@yourorg/ui";
import { CalendarDays, MapPin, Pencil } from "@yourorg/ui/icons";
import type { WorkOrderRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
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
  members: OrgMemberRecord[];
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
 * The dark hero band + relation-cards "sheet" at the top of the redesigned
 * work order screen (issue #102) — `RecordHeroBand` (title/badges/meta/
 * actions/assignee/stats) and `WorkOrderRelationCards` (Client/Site/Asset/
 * Contract) sharing ONE `Card className="ui-card-flush-xl"`, per
 * `RecordHeroBand`'s own doc comment on why the two need to be the same
 * rounded "sheet" rather than stacked separate cards. Owns the two small
 * popups (`WorkOrderStatusPriorityDialog`/`WorkOrderRelationsDialog`) behind
 * the badges row's and the relation cards' own Edit buttons — everything
 * else (Hours/Material/Checklist/Assignment) is a sibling below this,
 * assembled by `WorkOrderScreen` itself.
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
  members,
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

  const memberById = new Map(members.map((member) => [member.id, member]));
  const assignedMember = draft.assignedTo ? memberById.get(draft.assignedTo) : undefined;
  const createdByMember = workOrder?.created_by ? memberById.get(workOrder.created_by) : undefined;

  const resolvedSite =
    clientScoped.sites.find((candidate) => candidate.id === draft.siteId) ??
    (draft.siteId && site?.id === draft.siteId ? site : null);

  const meta: ReactNode[] = [];
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
    <Card className="ui-card-flush-xl">
      <RecordHeroBand
        recordLabel="Work Orders"
        recordHref="/work-orders"
        topRight={
          mode === "edit" && workOrder ? (
            <>Created {formatDateTime(workOrder.created_at, { month: "short" })}
              {createdByMember ? ` · ${memberDisplayName(createdByMember)}` : ""}
            </>
          ) : undefined
        }
        badges={
          <>
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
          </>
        }
        title={
          readOnly ? (
            <h1 className="ui-record-hero-band-title">{draft.title || "Untitled work order"}</h1>
          ) : (
            <input
              className="ui-record-hero-band-title-input"
              value={draft.title}
              placeholder="New work order"
              aria-label="Work order title"
              onChange={(event) => onTitleChange(event.target.value)}
              onBlur={(event) => onTitleBlur(event.target.value)}
            />
          )
        }
        meta={meta}
        actions={actions}
        assignee={
          assignedMember ? (
            <>
              <Avatar name={memberDisplayName(assignedMember)} />
              <span className="ui-record-hero-band-assignee-name">
                <strong>{memberDisplayName(assignedMember)}</strong>
                <span>Assigned engineer</span>
              </span>
            </>
          ) : undefined
        }
        stats={<StatStrip items={stats} />}
      />

      <div className="ui-card-flush-xl-body">
        <WorkOrderRelationCards
          draft={draft}
          client={client}
          site={site}
          asset={asset}
          contract={contract}
          clientScoped={clientScoped}
          readOnly={readOnly}
          onEdit={() => setRelationsOpen(true)}
        />
      </div>

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
    </Card>
  );
}
