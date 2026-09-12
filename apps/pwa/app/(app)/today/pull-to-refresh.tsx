"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Inline, Text } from "@yourorg/ui";
import { RefreshCw } from "@yourorg/ui/icons";

const PULL_THRESHOLD = 70;
const MAX_PULL = 110;
const REFRESHING_INDICATOR_HEIGHT = 48;

export interface PullToRefreshProps {
  /** Same fetch-and-save-to-Dexie flow the initial mount load uses
   * (`today-screen.tsx`'s `sync`) — a released pull-past-threshold just
   * re-triggers it. */
  onRefresh: () => Promise<void>;
  children: ReactNode;
}

/**
 * Native-touch-event pull-to-refresh (issue #169) — no gesture library.
 * Only takes over the gesture when the page is already scrolled to the
 * very top (checked live on every `touchmove`, not just at `touchstart`,
 * so a drag that scrolls the page away from the top mid-gesture correctly
 * abandons the pull instead of fighting native scrolling).
 *
 * Deliberately reads/writes the *document's* scroll position
 * (`document.scrollingElement`), not a local scrollable `<div>` — this
 * page has no nav chrome yet (see `app/(app)/layout.tsx`'s doc comment) and
 * scrolls at the window level, unlike the root app's fixed-height desktop
 * panels (e.g. Planning's backlog/grid).
 *
 * Registers listeners via a real `addEventListener` (not JSX `onTouch*`
 * props) specifically so `touchmove` can be `{ passive: false }` — only
 * that lets `preventDefault()` actually suppress the native overscroll/
 * bounce while a downward drag from the top is in progress; React's
 * built-in touch handlers are attached passive and can't do this.
 */
export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function isAtTop() {
      const scrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
      return scrollTop <= 0;
    }

    function handleTouchStart(event: TouchEvent) {
      if (refreshingRef.current) return;
      const touch = event.touches[0];
      if (!touch || !isAtTop()) {
        startYRef.current = null;
        pullingRef.current = false;
        return;
      }
      startYRef.current = touch.clientY;
      pullingRef.current = true;
    }

    function handleTouchMove(event: TouchEvent) {
      if (!pullingRef.current || startYRef.current === null || refreshingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;

      if (!isAtTop()) {
        // Scrolled away from the top mid-gesture — abandon the pull and
        // let native scrolling take back over.
        pullingRef.current = false;
        startYRef.current = null;
        setPullDistance(0);
        return;
      }

      const delta = touch.clientY - startYRef.current;
      if (delta <= 0) {
        setPullDistance(0);
        return;
      }
      event.preventDefault();
      setPullDistance(Math.min(delta, MAX_PULL));
    }

    function handleTouchEnd() {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      startYRef.current = null;

      setPullDistance((current) => {
        if (current >= PULL_THRESHOLD && !refreshingRef.current) {
          refreshingRef.current = true;
          setRefreshing(true);
          void onRefreshRef.current().finally(() => {
            refreshingRef.current = false;
            setRefreshing(false);
          });
        }
        return 0;
      });
    }

    root.addEventListener("touchstart", handleTouchStart, { passive: true });
    root.addEventListener("touchmove", handleTouchMove, { passive: false });
    root.addEventListener("touchend", handleTouchEnd, { passive: true });
    root.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      root.removeEventListener("touchstart", handleTouchStart);
      root.removeEventListener("touchmove", handleTouchMove);
      root.removeEventListener("touchend", handleTouchEnd);
      root.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  const indicatorHeight = refreshing ? REFRESHING_INDICATOR_HEIGHT : pullDistance;
  const indicatorVisible = indicatorHeight > 0;

  return (
    <div ref={rootRef}>
      {indicatorVisible && (
        <Inline
          justify="center"
          align="center"
          gap="xs"
          style={{
            height: `${indicatorHeight}px`,
            overflow: "hidden",
            transition: refreshing ? undefined : "height 0.05s linear",
          }}
        >
          <RefreshCw
            aria-hidden
            width={18}
            height={18}
            className={refreshing ? "ui-icon-spin" : undefined}
            style={{ opacity: refreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1) }}
          />
          <Text tone="muted">
            {refreshing ? "Vernieuwen…" : pullDistance >= PULL_THRESHOLD ? "Loslaten om te vernieuwen" : "Trek om te vernieuwen"}
          </Text>
        </Inline>
      )}
      {children}
    </div>
  );
}
