import { WebPage } from "@yourorg/ui/web";
import type { PlanningView } from "../types";

/**
 * Suspense fallback for `PlanningBoard` (docs/ARCHITECTURE.md "skeletons +
 * Suspense streaming, never bare spinners on primary views") — shaped like
 * the eventual dark header + backlog/grid two-column layout, so the page
 * never flashes a blank state while its several `await`s resolve. The real
 * title paints at once; the controls are placeholder bars.
 */
export function PlanningBoardSkeleton({ view }: { view: PlanningView }) {
  return (
    <WebPage aria-busy="true">
      <header className="web-page-header" data-kind="planning" aria-label="Planning">
        <div className="web-plan-header">
          <h1 className="web-page-title">Planning</h1>
          <span className="web-skeleton-bar" style={{ width: 280, height: 30, background: "var(--header-badge-neutral)" }} />
          <div className="web-plan-header-end">
            <span className="web-skeleton-bar" style={{ width: 210, height: 30, background: "var(--header-badge-neutral)" }} />
            <span className="web-skeleton-bar" style={{ width: 120, height: 30, background: "var(--header-badge-neutral)" }} />
            <span className="web-skeleton-bar" style={{ width: 150, height: 30, background: "var(--header-badge-neutral)" }} />
          </div>
        </div>
      </header>
      <div className="web-plan-main" aria-hidden="true">
        <section className="web-card web-plan-backlog">
          <header className="web-card-head">
            <span className="web-skeleton-bar" style={{ width: 90 }} />
          </header>
          <div className="web-plan-skeleton-card">
            {Array.from({ length: 5 }).map((_, index) => (
              <span key={index} className="web-skeleton-bar" style={{ width: "100%", height: 54 }} />
            ))}
          </div>
        </section>
        <div className="web-plan-area">
          {Array.from({ length: 2 }).map((_, index) => (
            <section key={index} className="web-card web-plan-card" data-view={view}>
              <header className="web-card-head">
                <span className="web-skeleton-bar" style={{ width: 140 }} />
              </header>
              <div className="web-plan-skeleton-card">
                {Array.from({ length: view === "week" ? 3 : 2 }).map((__, row) => (
                  <span key={row} className="web-skeleton-bar" style={{ width: "100%", height: 40 }} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </WebPage>
  );
}
