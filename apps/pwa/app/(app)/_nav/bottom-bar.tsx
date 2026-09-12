"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Text } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";

/** `@yourorg/ui` doesn't publish its internal `cx` helper at a subpath (only
 * `.`/`./icons`/`./styles.css` are exported, see its `package.json`) — this
 * tiny inline join is the same one-liner every call site outside the
 * package itself already falls back to. */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * The field PWA's whole primary nav (issue #170, IMPLEMENTATION.md §3) —
 * mounted once in `app/(app)/layout.tsx`, not per-page, so both `/today` and
 * `/work-orders/[id]` share one instance.
 *
 * Zone A ("Today") is always rendered, everywhere under `(app)` — a fixed
 * 86px-wide, always-present "default destination" tile. Zone B (the
 * work-order section tabs) only renders AT ALL while a `/work-orders/[id]`
 * route is active — per §3, "Rendert uitsluitend als er een werkorder open
 * is [...] Geen disabled tabs": on `/today` this slot shows one line of
 * plain help text instead of grayed-out targets, since there is nothing to
 * navigate to yet.
 *
 * `usePathname()`/`useSearchParams()` (not props) is deliberate — this is a
 * shared layout-level nav, so it derives "which work order, which section"
 * straight from the URL rather than requiring every page under it to thread
 * that state down through props/context.
 */
const WORK_ORDER_SECTIONS: { value: string; label: string }[] = [
  { value: "details", label: "Work" },
  { value: "hours", label: "Hours" },
  { value: "articles", label: "Articles" },
  { value: "photos", label: "Photos" },
  { value: "sign", label: "Sign off" },
];

export function BottomBar() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const workOrderMatch = /^\/work-orders\/([^/]+)/.exec(pathname);
  const workOrderId = workOrderMatch?.[1] ?? null;
  const activeSection = searchParams.get("section") ?? "details";
  const isToday = pathname === "/today";

  return (
    <nav className="ui-bottom-bar" aria-label="Primary">
      <Link
        href="/today"
        className={cx("ui-bottom-bar-today", isToday && "ui-bottom-bar-today-active")}
        aria-current={isToday ? "page" : undefined}
      >
        <ClipboardList aria-hidden width={20} height={20} />
        <span>Today</span>
      </Link>

      {workOrderId ? (
        <div className="ui-bottom-bar-context" role="tablist" aria-label="Work order sections">
          {WORK_ORDER_SECTIONS.map((section) => {
            const active = section.value === activeSection;
            return (
              <Link
                key={section.value}
                href={`/work-orders/${workOrderId}?section=${section.value}`}
                scroll={false}
                role="tab"
                aria-selected={active}
                className={cx("ui-bottom-bar-item", active && "ui-bottom-bar-item-active")}
              >
                <span className="ui-bottom-bar-item-indicator" aria-hidden />
                <span>{section.label}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="ui-bottom-bar-hint">
          <Text tone="muted">Open a work order for hours, articles, photos &amp; sign off</Text>
        </div>
      )}
    </nav>
  );
}
