"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type PageHeaderContextValue = {
  content: ReactNode;
  setContent: (content: ReactNode) => void;
};

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

/**
 * Mounted once around `<AppShell>` in `app/(app)/layout.tsx` — a Client
 * Component wrapping the (still server-rendered) shell/page tree so a page
 * deep in that tree can push content up into the `Topbar`'s `title` slot
 * without `app/(app)/layout.tsx` (one shared layout for every route) having
 * to know about it.
 *
 * `<PageHeaderSlot />` (rendered as `Topbar`'s `title`) reads `content`;
 * `usePageHeader()` (called by a page) writes it. Whichever page called
 * `usePageHeader()` last "wins" — fine today since only one route renders
 * at a time and the hook cleans up on unmount (see its own doc comment).
 */
export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const value = useMemo(() => ({ content, setContent }), [content]);
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

/**
 * Renders whatever the active page most recently set via `usePageHeader()`
 * — pass this as `Topbar`'s `title` prop (see `app/(app)/layout.tsx`). Falls
 * back to nothing for routes that haven't opted in yet (most of the app
 * today — see the narrow rollout note on `usePageHeader`).
 */
export function PageHeaderSlot() {
  const ctx = useContext(PageHeaderContext);
  return <>{ctx?.content ?? null}</>;
}

/**
 * A page calls this client-side to inject content (typically a
 * `Breadcrumbs` trail ending in the page's own title) into the Topbar
 * instead of rendering it inline in the scrolling `<main>`. Effect-based:
 * sets the shared content on mount/whenever `node` changes, clears it on
 * unmount so navigating away doesn't leave a stale title behind.
 *
 * `node` MUST be referentially stable across renders that don't actually
 * change the header (wrap it in `useMemo` in the caller, keyed on its real
 * inputs) — this is not just an optimization. The calling component is
 * itself a context consumer (via this hook's own `useContext` above), so
 * every `setContent` call re-renders it; if `node` is a fresh JSX element
 * each render (e.g. `usePageHeader(<Breadcrumbs items={x} />)` inline,
 * un-memoized), the effect's `[setContent, node]` dependency sees a new
 * `node` on that very re-render, fires again, and calls `setContent` again
 * — an infinite render loop ("Maximum update depth exceeded"), not a wasted
 * one. See `app/(app)/clients/[id]/client-detail.tsx` for the correct
 * pattern (the element itself is built with `useMemo`, not just the props
 * fed into it).
 *
 * Scoped narrowly today — only `app/(app)/clients/[id]/client-detail.tsx`
 * calls this; every other detail page still renders its own inline
 * `Breadcrumbs` (out of scope for this change, see that route's own code).
 */
export function usePageHeader(node: ReactNode) {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error("usePageHeader must be used within a PageHeaderProvider (see app/(app)/layout.tsx)");
  }
  const { setContent } = ctx;
  useEffect(() => {
    setContent(node);
    return () => setContent(null);
  }, [setContent, node]);
}
