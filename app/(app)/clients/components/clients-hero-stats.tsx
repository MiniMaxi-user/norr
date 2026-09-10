"use client";

import { formatPotentialValue } from "../kanban";
import { useClientsKanbanStatsValue, useClientsView } from "./clients-hero-context";

/**
 * The `OverviewHeroBand`'s `stats` slot (issue #142) — the kanban-only
 * "Klanten" / "Pipeline potential" readout. Rendered above `Suspense` in
 * `page.tsx`, but the numbers themselves only exist once `ClientsExplorer`
 * (inside `Suspense`) has fetched and filtered the client list, so this
 * renders nothing until `useClientsKanbanStatsValue()` has something to show
 * — see `clients-hero-context.tsx`.
 */
export function ClientsHeroStats() {
  const [view] = useClientsView();
  const stats = useClientsKanbanStatsValue();
  if (view !== "kanban" || !stats) return null;

  return (
    <div className="ui-clients-kanban-stats">
      <div className="ui-clients-kanban-stat">
        <div className="ui-clients-kanban-stat-label">Klanten</div>
        <div className="ui-clients-kanban-stat-value">{stats.count}</div>
      </div>
      <div className="ui-clients-kanban-stat">
        <div className="ui-clients-kanban-stat-label">Pipeline potential</div>
        <div className="ui-clients-kanban-stat-value">{formatPotentialValue(stats.potentialValue)}</div>
      </div>
    </div>
  );
}
