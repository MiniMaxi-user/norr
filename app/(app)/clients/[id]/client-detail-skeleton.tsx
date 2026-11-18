import { Skeleton, Spinner } from "@yourorg/ui";
import { WebPage } from "@yourorg/ui/web";

/** Shaped Suspense fallback for the client detail page — mirrors the new
 * design-system layout (white header with title/badges/tabs, key/value-row
 * cards in the centre, a rail on the right) so nothing jumps once the real
 * page streams in. Skeleton rows are the same height as real key/value rows;
 * the branded `Spinner` sits above (issue #140 follow-up convention). Uses
 * the same layout classes as the real page, so it needs no styles of its own. */
export function ClientDetailSkeleton() {
  return (
    <WebPage aria-hidden>
      <header className="web-page-header">
        <Skeleton height="0.9rem" width="10rem" />
        <div className="web-page-header-row">
          <div className="web-page-header-left">
            <div className="web-page-header-logo" />
            <div>
              <Skeleton height="2rem" width="16rem" />
              <div className="web-badge-row">
                <Skeleton height="22px" width="4.5rem" />
                <Skeleton height="22px" width="6rem" />
                <Skeleton height="22px" width="7rem" />
              </div>
            </div>
          </div>
          <Skeleton height="32px" width="8rem" />
        </div>
        <div className="web-tabs">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="web-tab">
              <Skeleton height="0.9rem" width="4.5rem" />
            </div>
          ))}
        </div>
      </header>
      <div className="web-detail">
        <div className="web-detail-main">
          <div className="web-card-stack">
            {[6, 4].map((rows, cardIndex) => (
              <section key={cardIndex} className="web-card">
                <header className="web-card-head">
                  <Skeleton height="0.9rem" width="8rem" />
                </header>
                {Array.from({ length: rows }).map((_, index) => (
                  <div key={index} className="web-kv-row">
                    <Skeleton height="10px" width="6rem" />
                    <Skeleton height="10px" width="9rem" />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
        <aside className="web-detail-rail">
          <div className="web-rail-section">
            <p className="web-rail-empty">
              <Spinner size={18} />
            </p>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="web-rail-row">
                <Skeleton height="10px" width="6rem" />
                <Skeleton height="10px" width="4rem" />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </WebPage>
  );
}
