"use client";

import Link from "next/link";
import { WebButton, WebLinkButton, WebStatusBadge } from "@yourorg/ui/web";
import { WebFloatingCard } from "@yourorg/ui/web-client";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { formatDetailDate, formatDurationHours, formatEndTime, formatTimeLabel } from "../date-utils";
import { typeColorStyle } from "../type-colors";
import { workOrderTitle } from "../work-order-title";
import { isLockedWorkOrder } from "./planning-grid";

export interface PlanningDetailSite {
  address_line1: string | null;
  city: string | null;
}

export interface PlanningDetailCardProps {
  workOrder: WorkOrderRecord;
  /** The block / backlog item the card hangs under. */
  anchor: HTMLElement;
  engineerName: string | null;
  clientName: string;
  site: PlanningDetailSite | null;
  onClose: () => void;
  onUnschedule: (workOrder: WorkOrderRecord) => void;
}

/**
 * Floating, non-modal detail card of a work order (DS 07 section 7), replacing
 * the old modal quick view: type badge + calm status badge + close, the ID as a
 * link with its title, date/time with duration, key/value rows with links
 * (Engineer, Client, Site, Asset, Contract), a two-line description and the
 * two actions. Sites have no page of their own, so the Site row is plain text.
 * "Unschedule" is hidden for backlog items and for locked (checked-out) ones.
 */
export function PlanningDetailCard({
  workOrder,
  anchor,
  engineerName,
  clientName,
  site,
  onClose,
  onUnschedule,
}: PlanningDetailCardProps) {
  const scheduledAt = workOrder.scheduled_at;
  const duration = workOrder.duration_minutes;
  const siteLabel = formatSiteAddressShort(site);
  const canUnschedule = scheduledAt != null && !isLockedWorkOrder(workOrder);
  const title = workOrderTitle(workOrder);
  const hasTitle = Boolean(workOrder.external_reference?.trim()) || Boolean(workOrder.description?.trim());

  return (
    <WebFloatingCard anchor={anchor} label={`Details ${workOrder.work_order_number}`} onClose={onClose}>
      <div className="web-plan-float-head">
        {workOrder.work_order_type ? (
          <span className="web-plan-typebadge" style={typeColorStyle(workOrder.work_order_type.color)}>
            {workOrder.work_order_type.label}
          </span>
        ) : null}
        {workOrder.work_order_status ? (
          <WebStatusBadge tone="neutral">{workOrder.work_order_status.label}</WebStatusBadge>
        ) : null}
        <button type="button" className="web-plan-float-close" aria-label="Close" onClick={onClose}>
          {"×"}
        </button>
      </div>

      <div className="web-plan-float-title">
        <Link href={`/work-orders/${workOrder.id}`} className="web-plan-id">
          {workOrder.work_order_number}
        </Link>
        {hasTitle ? title : null}
        <span className="web-plan-float-when">
          {scheduledAt ? (
            <>
              {formatDetailDate(scheduledAt)} {"·"} {formatTimeLabel(scheduledAt)}
              {"–"}
              {formatEndTime(scheduledAt, duration ?? 30)}{" "}
              {duration != null ? <span>({formatDurationHours(duration)})</span> : null}
            </>
          ) : (
            <>
              Not scheduled {duration != null ? <span>({formatDurationHours(duration)})</span> : <span>(no duration set)</span>}
            </>
          )}
        </span>
      </div>

      <dl className="web-plan-float-kv">
        {workOrder.assigned_to && engineerName ? (
          <div className="web-plan-float-row">
            <dt>Engineer</dt>
            <dd>
              <Link href={`/settings/team/${workOrder.assigned_to}`}>{engineerName}</Link>
            </dd>
          </div>
        ) : null}
        <div className="web-plan-float-row">
          <dt>Client</dt>
          <dd>
            <Link href={`/clients/${workOrder.client_id}`}>{clientName}</Link>
          </dd>
        </div>
        {siteLabel ? (
          <div className="web-plan-float-row">
            <dt>Site</dt>
            <dd>{siteLabel}</dd>
          </div>
        ) : null}
        {workOrder.asset ? (
          <div className="web-plan-float-row">
            <dt>Asset</dt>
            <dd>
              <Link href={`/assets/${workOrder.asset.id}`}>{workOrder.asset.name}</Link>
              {workOrder.asset.asset_model?.name ? ` ${workOrder.asset.asset_model.name}` : ""}
            </dd>
          </div>
        ) : null}
        {workOrder.contract ? (
          <div className="web-plan-float-row">
            <dt>Contract</dt>
            <dd>
              <Link href={`/contracts/${workOrder.contract.id}`}>{workOrder.contract.contract_number}</Link>
            </dd>
          </div>
        ) : null}
      </dl>
      {workOrder.description?.trim() ? (
        <div className="web-plan-float-descwrap">
          <p className="web-plan-float-desc">{workOrder.description.trim()}</p>
        </div>
      ) : null}

      <div className="web-plan-float-actions">
        <WebLinkButton variant="primary" size="sm" href={`/work-orders/${workOrder.id}`}>
          Open work order
        </WebLinkButton>
        {canUnschedule ? (
          <WebButton size="sm" onClick={() => onUnschedule(workOrder)}>
            Unschedule
          </WebButton>
        ) : null}
      </div>
    </WebFloatingCard>
  );
}
