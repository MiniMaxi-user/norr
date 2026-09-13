"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Text } from "@yourorg/ui";
import { Boxes, Building2, Camera, CalendarDays, Clock, Signature, type Icon } from "@yourorg/ui/icons";

/** `@yourorg/ui` doesn't publish its internal `cx` helper at a subpath (only
 * `.`/`./icons`/`./styles.css` are exported, see its `package.json`) — this
 * tiny inline join is the same one-liner every call site outside the
 * package itself already falls back to. */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * The field PWA's whole primary nav (issue #170, IMPLEMENTATION.md §3;
 * timeline restyle per `docs/designinstructieskanweg/menu.png`/`menu1.png`)
 * — mounted once in `app/(app)/layout.tsx`, not per-page, so both `/today`
 * and `/work-orders/[id]` share one instance.
 *
 * Zone A ("Today") is always rendered, everywhere under `(app)` — a fixed,
 * always-present "default destination" tile, styled as a permanently-lit
 * gold anchor (per the reference designs Today is gold in every shot,
 * independent of which section tab is actually open) rather than only
 * lighting up when `pathname === "/today"`. Zone B (the work-order section
 * tabs, rendered as a swipeable step timeline) only renders AT ALL while a
 * `/work-orders/[id]` route is active — per §3, "Rendert uitsluitend als er
 * een werkorder open is [...] Geen disabled tabs": on `/today` this slot
 * shows one line of plain help text instead of grayed-out targets, since
 * there is nothing to navigate to yet.
 *
 * Zone B's step state is a pure function of `activeIndex` (the open
 * section's position in `WORK_ORDER_SECTIONS`), not persisted history: steps
 * before the active one render green ("visited"), the active one gold with
 * a glow, steps after it dim/outline. Selecting an earlier step therefore
 * un-greens everything past it automatically — no extra state to reset.
 *
 * `usePathname()`/`useSearchParams()` (not props) is deliberate — this is a
 * shared layout-level nav, so it derives "which work order, which section"
 * straight from the URL rather than requiring every page under it to thread
 * that state down through props/context.
 */
const WORK_ORDER_SECTIONS: { value: string; label: string; icon: Icon }[] = [
  { value: "details", label: "Work", icon: Building2 },
  { value: "hours", label: "Hours", icon: Clock },
  { value: "articles", label: "Articles", icon: Boxes },
  { value: "photos", label: "Photos", icon: Camera },
  { value: "sign", label: "Sign", icon: Signature },
];

/**
 * Builds the single gradient line threading through every step circle:
 * solid green up to the step before the active one, a green→gold fade
 * across the segment leading INTO the active step (menu.png's line turning
 * gold as it nears "SIGN"), and dim/border color for whatever's left after
 * the active step. Segments are hard-stopped pairs (not one continuous
 * gradient) so only that one approach segment actually fades.
 */
function buildTrackGradient(activeIndex: number, count: number): string {
  if (count < 2) return "var(--ui-border)";
  const DONE = "var(--ui-success)";
  const ACTIVE = "var(--ui-accent)";
  const UPCOMING = "var(--ui-border)";
  const stops: string[] = [];
  for (let i = 0; i < count - 1; i++) {
    const startPct = (i / (count - 1)) * 100;
    const endPct = ((i + 1) / (count - 1)) * 100;
    const [startColor, endColor] =
      i + 1 < activeIndex ? [DONE, DONE] : i + 1 === activeIndex ? [DONE, ACTIVE] : [UPCOMING, UPCOMING];
    stops.push(`${startColor} ${startPct}%`, `${endColor} ${endPct}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export function BottomBar() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const workOrderMatch = /^\/work-orders\/([^/]+)/.exec(pathname);
  const workOrderId = workOrderMatch?.[1] ?? null;
  const activeSection = searchParams.get("section") ?? "details";
  const isToday = pathname === "/today";
  const activeIndex = WORK_ORDER_SECTIONS.findIndex((section) => section.value === activeSection);

  return (
    <nav className="ui-bottom-bar" aria-label="Primary">
      <Link href="/today" className="ui-bottom-bar-today" aria-current={isToday ? "page" : undefined}>
        <span className="ui-bottom-bar-circle ui-bottom-bar-circle-active">
          <CalendarDays aria-hidden width={20} height={20} />
        </span>
        <span className="ui-bottom-bar-label ui-bottom-bar-label-active">Today</span>
      </Link>

      {workOrderId ? (
        <>
          <span className="ui-bottom-bar-dash" aria-hidden />
          <div className="ui-bottom-bar-context" role="tablist" aria-label="Work order sections">
            <div className="ui-bottom-bar-track">
              <span
                className="ui-bottom-bar-track-line"
                aria-hidden
                style={{
                  background: buildTrackGradient(activeIndex, WORK_ORDER_SECTIONS.length),
                  width: `calc((${WORK_ORDER_SECTIONS.length - 1}) * var(--ui-bottom-bar-track-item-w))`,
                }}
              />
              {WORK_ORDER_SECTIONS.map((section, index) => {
                const Icon = section.icon;
                const active = index === activeIndex;
                const done = !active && index < activeIndex;
                return (
                  <Link
                    key={section.value}
                    href={`/work-orders/${workOrderId}?section=${section.value}`}
                    scroll={false}
                    role="tab"
                    aria-selected={active}
                    className="ui-bottom-bar-track-item"
                  >
                    <span
                      className={cx(
                        "ui-bottom-bar-circle",
                        active && "ui-bottom-bar-circle-active",
                        done && "ui-bottom-bar-circle-done",
                      )}
                    >
                      <Icon aria-hidden width={20} height={20} />
                    </span>
                    <span
                      className={cx(
                        "ui-bottom-bar-label",
                        active && "ui-bottom-bar-label-active",
                        done && "ui-bottom-bar-label-done",
                      )}
                    >
                      {section.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="ui-bottom-bar-hint">
          <Text tone="muted">Open a work order for hours, articles, photos &amp; sign off</Text>
        </div>
      )}
    </nav>
  );
}
