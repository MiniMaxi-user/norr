/**
 * Shared response-contract types for `/api/work-orders/[id]` (issue #170).
 * Plain data shapes only (no server-only imports) so both the route handler
 * and the client-side detail screen can import from here without pulling
 * server code into a "use client" bundle — same split
 * `lib/offline/db.ts`'s `CachedWorkItem` already establishes for
 * `/api/workitems/today`.
 */

import type { TimeRoundingRule } from "@yourorg/time-rounding";

export type { TimeRoundingRule };

/** The caller's org's issue #198 travel/work minimum + rounding settings —
 * included on both `/api/work-orders/[id]` and `/api/workitems/today`
 * responses so the PWA has this cached offline before any specific work
 * order is even opened. Display/computation of net vs. gross duration using
 * this is a separate (frontend-ui-engineer) pass — this type only carries
 * the data. */
export interface TimeRoundingSettings {
  travel: TimeRoundingRule;
  work: TimeRoundingRule;
}

export interface WorkOrderDetailReference {
  label: string;
  color: string | null;
}

export interface WorkOrderDetailClient {
  id: string;
  name: string;
}

export interface WorkOrderDetailSite {
  id: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  /** Site's own contact number (`sites.phone`) — a site, not a client, has
   * the "Call contact" number, see `app/(app)/clients/actions.ts`'s
   * `SiteRecord.phone` doc comment. */
  phone: string | null;
}

export interface WorkOrderDetailAsset {
  id: string;
  name: string;
  serialNumber: string | null;
  /** ISO date/datetime, or `null` when not recorded. */
  installedAt: string | null;
  brand: string | null;
  model: string | null;
}

export interface WorkOrderDetailContract {
  id: string;
  name: string;
  type: string | null;
  startDate: string;
  endDate: string | null;
}

export interface WorkOrderDetail {
  id: string;
  title: string;
  description: string | null;
  /** Free-text record of how this work order was resolved
   * (`work_orders.solution`) — parallel to `activities.solution`, but this
   * is the work-order-level equivalent since not every work order has a
   * `source_activity_id` to fall back to. Written by the engineer on the
   * PWA's Sign off tab, synced to the server on Finish. */
  solution: string | null;
  scheduledAt: string | null;
  status: WorkOrderDetailReference | null;
  priority: WorkOrderDetailReference | null;
  client: WorkOrderDetailClient | null;
  site: WorkOrderDetailSite | null;
  asset: WorkOrderDetailAsset | null;
  contract: WorkOrderDetailContract | null;
}

export interface WorkOrderTimeEntry {
  id: string;
  userId: string;
  kind: "travel" | "work";
  /** ISO datetime. */
  startedAt: string;
  /** ISO datetime, `null` while running. */
  endedAt: string | null;
}

export interface WorkOrderArticleEntry {
  id: string;
  articleId: string;
  articleNumber: string;
  description: string;
  quantity: number;
}

export interface WorkOrderDetailResponse {
  workOrder: WorkOrderDetail;
  timeEntries: WorkOrderTimeEntry[];
  articles: WorkOrderArticleEntry[];
  /** Issue #198: the caller's org's travel/work minimum + rounding settings
   * — self-contained so a work order detail deep-link doesn't need a
   * separate round trip to compute net (billable) durations. */
  timeRoundingSettings: TimeRoundingSettings;
}

/** `/api/articles/catalog` response item — the "Add article" bottom sheet's
 * catalog list. */
export interface CatalogArticle {
  id: string;
  articleNumber: string;
  description: string;
}
