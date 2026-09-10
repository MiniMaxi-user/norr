"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { StatStripItem } from "@yourorg/ui";
import type { WorkOrderArticleRecord } from "../work-order-articles-actions";
import type { WorkOrderChecklistItemRecord, WorkOrderChecklistRecord } from "../checklist-actions";
import type { WorkOrderCostSummary } from "../quote-sync-actions";
import { formatCurrency } from "@/lib/format/currency";

interface WorkOrderHeroStatsContextValue {
  materialStat: StatStripItem | null;
  setMaterialStat: (stat: StatStripItem | null) => void;
  checklistStat: StatStripItem | null;
  setChecklistStat: (stat: StatStripItem | null) => void;
  toInvoiceStat: StatStripItem | null;
  setToInvoiceStat: (stat: StatStripItem | null) => void;
}

const WorkOrderHeroStatsContext = createContext<WorkOrderHeroStatsContextValue | null>(null);

/**
 * Bridges the Material/Checklist/"To invoice" `StatStrip` tiles across the
 * per-section `Suspense` boundaries introduced by issue #146: `[id]/page.tsx`
 * now renders `WorkOrderScreen` as soon as `getCurrentSession()` +
 * `getWorkOrder()` resolve, WITHOUT waiting for `workOrderArticles`/
 * `checklistItems`/`costSummary` — those are fetched by three separate async
 * Server Components (`work-order-material-slot.tsx`/`-checklist-slot.tsx`/
 * `-hours-slot.tsx`, each in its own `<Suspense>`) so the Hours/Material/
 * Checklist sections stream in independently. But those same three numbers
 * ALSO feed the hero's OWN stat strip (issue #106), which renders above every
 * one of those boundaries — so each slot's resolved data, once available,
 * has to be reported back UP to the hero. Same "client component pushes
 * state up across a boundary" shape `clients-hero-context.tsx` already
 * established for the Clients kanban stat readout — see that file's own doc
 * comment for the precedent.
 *
 * Unlike Clients (where the provider wraps a page-level `Suspense` boundary
 * from `page.tsx`), `WorkOrderScreen` itself is the one client component both
 * the hero and the three slots render inside (see that file's own module doc
 * comment for why it stays one shared screen) — so `WorkOrderScreen` mounts
 * this provider directly, wrapping its own returned tree, rather than a
 * server `page.tsx` mounting it around a `<Suspense>` the way Clients' does.
 *
 * Only ever populated in `mode: "edit"` — `mode: "create"` has no slots at
 * all (every section renders its local, always-synchronously-available draft
 * data directly), so `WorkOrderScreen` computes those three tiles the old
 * synchronous way in that mode instead of reading them back out of here.
 */
export function WorkOrderHeroStatsProvider({ children }: { children: ReactNode }) {
  const [materialStat, setMaterialStat] = useState<StatStripItem | null>(null);
  const [checklistStat, setChecklistStat] = useState<StatStripItem | null>(null);
  const [toInvoiceStat, setToInvoiceStat] = useState<StatStripItem | null>(null);

  const value = useMemo<WorkOrderHeroStatsContextValue>(
    () => ({ materialStat, setMaterialStat, checklistStat, setChecklistStat, toInvoiceStat, setToInvoiceStat }),
    [materialStat, setMaterialStat, checklistStat, setChecklistStat, toInvoiceStat, setToInvoiceStat],
  );

  return <WorkOrderHeroStatsContext.Provider value={value}>{children}</WorkOrderHeroStatsContext.Provider>;
}

function useWorkOrderHeroStatsContext() {
  const ctx = useContext(WorkOrderHeroStatsContext);
  if (!ctx) {
    throw new Error(
      "Work order hero stat hooks must be used within a WorkOrderHeroStatsProvider (see work-order-screen.tsx)",
    );
  }
  return ctx;
}

/** Called by `WorkOrderMaterialStatsReporter` once `work-order-material-slot.tsx`'s
 * fetch resolves. `stat` MUST be referentially stable across renders that
 * don't actually change the numbers (the reporter memoizes it) — same
 * warning `useClientsKanbanStats` documents for its own `stats` param. */
export function useWorkOrderMaterialStat(stat: StatStripItem | null) {
  const { setMaterialStat } = useWorkOrderHeroStatsContext();
  useEffect(() => {
    setMaterialStat(stat);
    return () => setMaterialStat(null);
  }, [setMaterialStat, stat]);
}

/** Called by `WorkOrderChecklistStatsReporter` once `work-order-checklist-slot.tsx`'s
 * fetch resolves. Same stability requirement as `useWorkOrderMaterialStat`. */
export function useWorkOrderChecklistStat(stat: StatStripItem | null) {
  const { setChecklistStat } = useWorkOrderHeroStatsContext();
  useEffect(() => {
    setChecklistStat(stat);
    return () => setChecklistStat(null);
  }, [setChecklistStat, stat]);
}

/** Called by whichever of `WorkOrderMaterialStatsReporter` (an engineer, no
 * `canSeeCosts`) or `WorkOrderCostStatsReporter` (everyone else) owns the "To
 * invoice" tile for this caller — see each reporter's own doc comment for why
 * the split. Same stability requirement as `useWorkOrderMaterialStat`. */
export function useWorkOrderToInvoiceStat(stat: StatStripItem | null) {
  const { setToInvoiceStat } = useWorkOrderHeroStatsContext();
  useEffect(() => {
    setToInvoiceStat(stat);
    return () => setToInvoiceStat(null);
  }, [setToInvoiceStat, stat]);
}

/** Read by `WorkOrderScreen` (`mode: "edit"` only) to fill the hero's stat
 * strip — `null` for any tile whose slot hasn't resolved yet, which
 * `WorkOrderScreen` renders as a small `Skeleton` in that tile's value. */
export function useWorkOrderHeroStatsValue() {
  const { materialStat, checklistStat, toInvoiceStat } = useWorkOrderHeroStatsContext();
  return { materialStat, checklistStat, toInvoiceStat };
}

/**
 * Rendered by `work-order-material-slot.tsx` alongside `WorkOrderMaterialSection`
 * once `listWorkOrderArticles`/`listArticlesForSelect` resolve. Reports the
 * "Material" tile always, and the "To invoice" tile too when `reportToInvoice`
 * (`!canSeeCosts`, computed by `[id]/page.tsx`) — an engineer's material-only
 * fallback figure, identical to the pre-#146 synchronous computation (see
 * `WorkOrderCostStatsReporter`'s own doc comment for the other half of this
 * split). Renders nothing itself — a pure reporting side-effect, same shape
 * as `ClientsHeroStats`' sibling in `clients-hero-context.tsx`.
 */
export function WorkOrderMaterialStatsReporter({
  workOrderArticles,
  reportToInvoice,
}: {
  workOrderArticles: WorkOrderArticleRecord[];
  reportToInvoice: boolean;
}) {
  const materialTotal = useMemo(
    () => workOrderArticles.reduce((sum, row) => sum + row.quantity * (row.article?.sale_price ?? 0), 0),
    [workOrderArticles],
  );
  const materialStat = useMemo<StatStripItem>(
    () => ({
      label: "Material",
      value: formatCurrency(materialTotal),
      hint: `${workOrderArticles.length} ${workOrderArticles.length === 1 ? "article" : "articles"}`,
    }),
    [materialTotal, workOrderArticles.length],
  );
  useWorkOrderMaterialStat(materialStat);

  const toInvoiceStat = useMemo<StatStripItem | null>(
    () =>
      reportToInvoice ? { label: "To invoice", value: formatCurrency(materialTotal), hint: "Material only" } : null,
    [reportToInvoice, materialTotal],
  );
  useWorkOrderToInvoiceStat(toInvoiceStat);

  return null;
}

/**
 * Rendered by `work-order-checklist-slot.tsx` alongside `WorkOrderChecklistSection`
 * once `getWorkOrderChecklist` resolves. Reports the "Checklist" tile —
 * identical figures to the pre-#146 synchronous computation. Renders nothing
 * itself, same shape as `WorkOrderMaterialStatsReporter` above.
 */
export function WorkOrderChecklistStatsReporter({
  checklist,
  checklistItems,
}: {
  checklist: WorkOrderChecklistRecord | null;
  checklistItems: WorkOrderChecklistItemRecord[];
}) {
  const checklistChecked = useMemo(
    () => checklistItems.filter((item) => item.is_checked).length,
    [checklistItems],
  );
  const stat = useMemo<StatStripItem>(
    () => ({
      label: "Checklist",
      value: checklist ? `${checklistChecked} / ${checklistItems.length}` : "—",
      progress: checklist && checklistItems.length > 0 ? (checklistChecked / checklistItems.length) * 100 : undefined,
      hint: !checklist ? "Not attached" : undefined,
    }),
    [checklist, checklistChecked, checklistItems.length],
  );
  useWorkOrderChecklistStat(stat);

  return null;
}

/**
 * Rendered by `work-order-hours-slot.tsx` (only when `canSeeCosts`) alongside
 * `WorkOrderHoursSection`, once `getWorkOrderCostSummary` resolves. Reports
 * the "To invoice" tile from the real material + travel + labor total — see
 * `WorkOrderMaterialStatsReporter` above for the engineer (`!canSeeCosts`)
 * fallback that owns this same tile instead.
 *
 * `costSummary === null` here (rather than never rendering this reporter at
 * all) means `canSeeCosts` passed but `getWorkOrderCostSummary` itself
 * returned no data — a genuine fetch error, not the ordinary "engineer, never
 * fetched" case (that's `!canSeeCosts`, handled entirely by
 * `WorkOrderMaterialStatsReporter` instead). Pre-#146, this one synchronous
 * component had both figures in scope and fell back to the material-only
 * total in that case; split across independent `Suspense` boundaries, this
 * reporter has no access to that figure, so it degrades to "—" instead — only
 * reachable on an actual error.
 */
export function WorkOrderCostStatsReporter({ costSummary }: { costSummary: WorkOrderCostSummary | null }) {
  const toInvoiceQuoteLink = useMemo(
    () =>
      costSummary?.quoteId ? (
        <Link href={`/quotes/${costSummary.quoteId}`}>{costSummary.quoteName ?? "View quote"}</Link>
      ) : null,
    [costSummary?.quoteId, costSummary?.quoteName],
  );

  const stat = useMemo<StatStripItem>(() => {
    if (!costSummary) {
      return { label: "To invoice", value: "—", hint: "Could not load costs" };
    }
    if (costSummary.hasPromotedQuote) {
      return {
        label: "To invoice",
        value: "—",
        hint: toInvoiceQuoteLink ? <>Already quoted — {toInvoiceQuoteLink}</> : "Already quoted — see Quotes",
      };
    }
    return { label: "To invoice", value: formatCurrency(costSummary.grandTotal), hint: toInvoiceQuoteLink };
  }, [costSummary, toInvoiceQuoteLink]);
  useWorkOrderToInvoiceStat(stat);

  return null;
}
