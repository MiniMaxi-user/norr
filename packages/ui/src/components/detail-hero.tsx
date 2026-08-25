import type { ReactNode } from "react";
import { cx } from "../cx";
import { Avatar } from "./avatar";
import { Heading } from "./typography";

export interface DetailHeroProps {
  /** Fed to `Avatar` (`size="lg"`) to derive the hero-mark initials. */
  avatarLabel: string;
  title: ReactNode;
  /** Rendered dot-separated (`·`), left to right, before `badges`. Omit or
   * pass an empty array when there's nothing to show yet. */
  meta?: ReactNode[];
  /** Rendered immediately after the last `meta` item with normal flex gap —
   * no leading dot (matches the approved mockup's DOM: badges just follow
   * the dot-separated text items). */
  badges?: ReactNode;
  /** Right-aligned slot, e.g. Edit/Delete buttons. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Editorial header ("Option C") for a top-level entity's detail page —
 * Clients today (`app/(app)/clients/[id]/client-detail.tsx`), Assets/Work
 * Orders/Contracts/Quotes once those get their own detail pages. See
 * `stories/EditorialDetailPage.stories.tsx` for the canonical generic
 * reference and docs/ARCHITECTURE.md's "Relational detail pages" section.
 *
 * Deliberately generic — no Client-specific naming/shape — so any top-level
 * entity's detail page can reuse it as-is. Anything address/map-specific
 * (like Clients' Sites-tab side map) is the composing page's concern, not
 * this component's.
 */
export function DetailHero({ avatarLabel, title, meta = [], badges, actions, className }: DetailHeroProps) {
  const metaNodes: ReactNode[] = [];
  meta.forEach((item, index) => {
    if (index > 0) {
      metaNodes.push(<span key={`dot-${index}`} className="ui-detail-hero-dot" aria-hidden="true" />);
    }
    metaNodes.push(<span key={`item-${index}`}>{item}</span>);
  });
  const hasMetaLine = metaNodes.length > 0 || Boolean(badges);

  return (
    <div className={cx("ui-detail-hero", className)}>
      <div className="ui-detail-hero-left">
        <Avatar name={avatarLabel} size="lg" />
        <div className="ui-detail-hero-heading">
          <Heading level={1} className="ui-detail-hero-title">
            {title}
          </Heading>
          {hasMetaLine && (
            <div className="ui-detail-hero-meta">
              {metaNodes}
              {badges}
            </div>
          )}
        </div>
      </div>
      {actions ? <div className="ui-detail-hero-actions">{actions}</div> : null}
    </div>
  );
}
