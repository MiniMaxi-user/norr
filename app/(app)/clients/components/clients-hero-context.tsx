"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ClientsView = "list" | "kanban";

export interface ClientsKanbanStats {
  count: number;
  potentialValue: number;
}

interface ClientsHeroContextValue {
  view: ClientsView;
  setView: (view: ClientsView) => void;
  kanbanStats: ClientsKanbanStats | null;
  setKanbanStats: (stats: ClientsKanbanStats | null) => void;
}

const ClientsHeroContext = createContext<ClientsHeroContextValue | null>(null);

/**
 * Bridges the Clients list/kanban view state across the `Suspense` boundary
 * in `app/(app)/clients/page.tsx` (issue #142): the page's `OverviewHeroBand`
 * — title, `ViewToggle`, "Add client", and the kanban stat readout — now
 * renders as a direct sibling BEFORE `<Suspense>` so the `h1` paints
 * immediately, but the view toggle still has to control what `ClientsBoard`
 * (inside `Suspense`, fetched from real client data) renders, and the kanban
 * stats still need that fetched data to compute. Same
 * "client component pushes/reads shared state across a boundary" shape as
 * `components/shell/page-header-context.tsx` — just two-way instead of
 * one-way: `view` flows down (hero band -> `ClientsExplorer`), `kanbanStats`
 * flows up (`ClientsExplorer` -> hero band) once resolved.
 *
 * Mounted once in `page.tsx`, wrapping both the hero band and the `Suspense`
 * boundary — it's plain client state (no data fetch of its own), so it
 * renders instantly and never itself suspends.
 */
export function ClientsHeroProvider({
  defaultView,
  children,
}: {
  defaultView: ClientsView;
  children: ReactNode;
}) {
  const [view, setView] = useState<ClientsView>(defaultView);
  const [kanbanStats, setKanbanStats] = useState<ClientsKanbanStats | null>(null);
  const value = useMemo(
    () => ({ view, setView, kanbanStats, setKanbanStats }),
    [view, kanbanStats],
  );
  return <ClientsHeroContext.Provider value={value}>{children}</ClientsHeroContext.Provider>;
}

function useClientsHeroContext() {
  const ctx = useContext(ClientsHeroContext);
  if (!ctx) {
    throw new Error("Clients hero hooks must be used within a ClientsHeroProvider (see app/(app)/clients/page.tsx)");
  }
  return ctx;
}

/** Read/set the active list-vs-kanban view. Used by both `ClientsHeroActions`
 * (the `ViewToggle`, rendered above `Suspense`) and `ClientsExplorer` (which
 * decides table vs. kanban render, rendered inside `Suspense`). */
export function useClientsView() {
  const { view, setView } = useClientsHeroContext();
  return [view, setView] as const;
}

/**
 * Called by `ClientsExplorer` once it has kanban data to report ("Klanten" /
 * "Pipeline potential"). Effect-based, same stale-closure-avoidance shape as
 * `usePageHeader` — `stats` MUST be referentially stable across renders that
 * don't actually change the numbers (the caller memoizes it), or this fires
 * every render.
 */
export function useClientsKanbanStats(stats: ClientsKanbanStats | null) {
  const { setKanbanStats } = useClientsHeroContext();
  useEffect(() => {
    setKanbanStats(stats);
    return () => setKanbanStats(null);
  }, [setKanbanStats, stats]);
}

/** Read the kanban stats most recently reported via `useClientsKanbanStats` —
 * `null` until `ClientsExplorer`'s data has resolved. Used by
 * `ClientsHeroStats`. */
export function useClientsKanbanStatsValue() {
  return useClientsHeroContext().kanbanStats;
}
